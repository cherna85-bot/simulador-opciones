require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");

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

app.use(express.static(path.join(__dirname, "..")));

app.listen(PORT, () => {
  console.log(`Simulador con integración TradeStation (${TS_ENV.toUpperCase()}) en http://localhost:${PORT}`);
  if (!isConfigured()) {
    console.log("Nota: TS_CLIENT_ID/TS_CLIENT_SECRET no configurados todavía — ver server/.env.example");
  }
});
