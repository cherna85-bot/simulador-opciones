require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const { parseEarningsCalendarCsv } = require("../logic.js");

const app = express();
const PORT = process.env.PORT || 3000;
const TOKENS_PATH = path.join(__dirname, "tokens.json");

const TS_ENV = process.env.TS_ENV === "live" ? "live" : "sim";
const TS_BASE =
  TS_ENV === "live" ? "https://api.tradestation.com/v3" : "https://sim-api.tradestation.com/v3";
const AUTHORIZE_URL = "https://signin.tradestation.com/authorize";
const TOKEN_URL = "https://signin.tradestation.com/oauth/token";
const SCOPE = "openid profile MarketData offline_access";

function isConfigured() {
  return Boolean(process.env.TS_CLIENT_ID && process.env.TS_CLIENT_SECRET);
}

function requireConfig(req, res, next) {
  if (!isConfigured()) {
    return res.status(500).json({
      error:
        "TradeStation no está configurado todavía. Copia server/.env.example a server/.env y completa TS_CLIENT_ID y TS_CLIENT_SECRET.",
    });
  }
  next();
}

const AV_BASE = "https://www.alphavantage.co/query";

function isAVConfigured() {
  return Boolean(process.env.ALPHAVANTAGE_API_KEY);
}

function requireAVConfig(req, res, next) {
  if (!isAVConfigured()) {
    return res.status(500).json({
      error:
        "Alpha Vantage no está configurado todavía. Copia server/.env.example a server/.env y completa ALPHAVANTAGE_API_KEY (gratis en alphavantage.co/support/#api-key).",
    });
  }
  next();
}

// Cache en memoria simple para no quemar la cuota gratuita de Alpha Vantage (~25 requests/día).
const avCache = new Map();
async function cached(key, ttlMs, fetchFn) {
  const hit = avCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fetchFn();
  avCache.set(key, { value, at: Date.now() });
  return value;
}

// Alpha Vantage's free tier rejects bursts faster than ~1 request/second, and
// the frontend fires fundamentals/earnings/news for the same symbol in
// parallel — so every AV call is serialized through this queue with a
// minimum gap between requests, regardless of how many arrive at once.
const AV_MIN_GAP_MS = 1100;
let avQueue = Promise.resolve();

function queuedFetch(url) {
  const result = avQueue.then(async () => {
    const resp = await fetch(url);
    await new Promise((resolve) => setTimeout(resolve, AV_MIN_GAP_MS));
    return resp;
  });
  avQueue = result.then(
    () => {},
    () => {}
  );
  return result;
}

async function alphaVantage(params) {
  const url = `${AV_BASE}?${new URLSearchParams({ ...params, apikey: process.env.ALPHAVANTAGE_API_KEY })}`;
  const resp = await queuedFetch(url);
  if (!resp.ok) {
    throw new Error(`Alpha Vantage respondió ${resp.status}`);
  }
  return resp;
}

function readTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeTokens(tokens) {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

async function refreshAccessToken(tokens) {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.TS_CLIENT_ID,
      client_secret: process.env.TS_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
    }),
  });
  if (!resp.ok) {
    throw new Error(`No se pudo refrescar el token (${resp.status}): ${await resp.text()}`);
  }
  const fresh = await resp.json();
  const merged = {
    ...tokens,
    access_token: fresh.access_token,
    obtained_at: Date.now(),
    expires_in: fresh.expires_in,
  };
  writeTokens(merged);
  return merged;
}

async function getValidAccessToken() {
  let tokens = readTokens();
  if (!tokens) {
    throw new Error("No hay una cuenta de TradeStation conectada. Visita /auth/login primero.");
  }
  const ageSeconds = (Date.now() - tokens.obtained_at) / 1000;
  const expiresIn = tokens.expires_in || 1200;
  if (ageSeconds > expiresIn - 60) {
    tokens = await refreshAccessToken(tokens);
  }
  return tokens.access_token;
}

app.get("/auth/login", requireConfig, (req, res) => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.TS_CLIENT_ID,
    redirect_uri: process.env.TS_REDIRECT_URI,
    audience: "https://api.tradestation.com",
    scope: SCOPE,
  });
  res.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
});

app.get("/auth/callback", requireConfig, async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(`TradeStation devolvió un error: ${error}`);
  }
  if (!code) {
    return res.status(400).send("Falta el parámetro 'code' en el callback.");
  }
  try {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.TS_CLIENT_ID,
        client_secret: process.env.TS_CLIENT_SECRET,
        code,
        redirect_uri: process.env.TS_REDIRECT_URI,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Token endpoint respondió ${resp.status}: ${await resp.text()}`);
    }
    const data = await resp.json();
    writeTokens({ ...data, obtained_at: Date.now() });
    res.redirect("/?connected=1");
  } catch (err) {
    res.status(500).send(`No se pudo completar la conexión con TradeStation: ${err.message}`);
  }
});

app.get("/api/status", (req, res) => {
  res.json({
    configured: isConfigured(),
    connected: Boolean(readTokens()),
    env: TS_ENV,
    alphaVantageConfigured: isAVConfigured(),
  });
});

app.get("/api/quote/:symbol", requireConfig, async (req, res) => {
  try {
    const token = await getValidAccessToken();
    const resp = await fetch(`${TS_BASE}/marketdata/quotes/${encodeURIComponent(req.params.symbol)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: await resp.text() });
    }
    res.json(await resp.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/options/:symbol", requireConfig, async (req, res) => {
  try {
    const token = await getValidAccessToken();
    const qs = req.query.expiration
      ? `?expiration=${encodeURIComponent(req.query.expiration)}`
      : "";
    const resp = await fetch(
      `${TS_BASE}/marketdata/options/chains/${encodeURIComponent(req.params.symbol)}${qs}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) {
      return res.status(resp.status).json({ error: await resp.text() });
    }
    res.json(await resp.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Object.create(null): sin cadena de prototipos, así "__proto__"/"constructor"
// como valor de tf no pueden devolver algo "truthy" y saltarse la validación.
const BAR_TF = Object.assign(Object.create(null), {
  "5m": { interval: 5, barsback: 60 }, // ~5h de contexto
  "1h": { interval: 60, barsback: 48 }, // ~2 días de contexto
  "4h": { interval: 240, barsback: 30 }, // ~5 días de contexto
});

app.get("/api/bars/:symbol", requireConfig, async (req, res) => {
  const tf = BAR_TF[req.query.tf];
  if (!tf) {
    return res.status(400).json({ error: "Parámetro 'tf' inválido. Usa 5m, 1h o 4h." });
  }
  try {
    const token = await getValidAccessToken();
    const params = new URLSearchParams({
      unit: "Minute",
      interval: String(tf.interval),
      barsback: String(tf.barsback),
    });
    const resp = await fetch(
      `${TS_BASE}/marketdata/barcharts/${encodeURIComponent(req.params.symbol)}?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) {
      return res.status(resp.status).json({ error: await resp.text() });
    }
    res.json(await resp.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/fundamentals/:symbol", requireAVConfig, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const data = await cached(`overview:${symbol}`, 60 * 60 * 1000, async () => {
      const resp = await alphaVantage({ function: "OVERVIEW", symbol });
      return resp.json();
    });
    if (!data || !data.Symbol) {
      return res.status(404).json({ error: "No se encontraron datos fundamentales para ese símbolo." });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/earnings/:symbol", requireAVConfig, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const csv = await cached(`earnings-calendar:${symbol}`, 60 * 60 * 1000, async () => {
      const resp = await alphaVantage({ function: "EARNINGS_CALENDAR", symbol, horizon: "3month" });
      return resp.text();
    });
    const todayIso = new Date().toISOString().slice(0, 10);
    const nextReportDate = parseEarningsCalendarCsv(csv, symbol, todayIso);
    res.json({ symbol, nextReportDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/news/:symbol", requireAVConfig, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const data = await cached(`news:${symbol}`, 15 * 60 * 1000, async () => {
      const resp = await alphaVantage({ function: "NEWS_SENTIMENT", tickers: symbol, limit: "10" });
      return resp.json();
    });
    if (data.Information || data.Note) {
      // Alpha Vantage devuelve 200 OK con este cuerpo cuando se excede el límite de la API.
      return res.status(429).json({ error: data.Information || data.Note });
    }
    const items = (data.feed || []).slice(0, 5).map((item) => ({
      title: item.title,
      url: item.url,
      source: item.source,
      timePublished: item.time_published,
      sentimentLabel: item.overall_sentiment_label,
    }));
    res.json({ symbol, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Servimos solo los 2 archivos que el frontend realmente necesita (index.html
// y logic.js), NO todo el directorio del proyecto con express.static(): ese
// directorio es el padre de server/, así que serviría también server/server.js
// y — más grave — server/tokens.json (el access/refresh token real de
// TradeStation una vez conectada la cuenta) como si fueran archivos públicos.
const PROJECT_ROOT = path.join(__dirname, "..");
app.get("/", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "index.html"));
});
app.get("/logic.js", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "logic.js"));
});

// Bind explícito a localhost: sin esto, Node escucha en todas las interfaces
// de red (0.0.0.0), y con la cuenta de TradeStation/la key de Alpha Vantage
// conectadas, cualquier otro dispositivo en la misma red WiFi/LAN podría
// llamar a estos endpoints sin ninguna autenticación propia.
const HOST = "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(`Simulador con integración TradeStation (${TS_ENV.toUpperCase()}) en http://localhost:${PORT}`);
  if (!isConfigured()) {
    console.log("Nota: TS_CLIENT_ID/TS_CLIENT_SECRET no configurados todavía — ver server/.env.example");
  }
});
