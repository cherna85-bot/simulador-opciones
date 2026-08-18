(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.OptionsLogic = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function round(n) {
    return Math.round(n * 100) / 100;
  }

  function payoffAt(legs, S) {
    let total = 0;
    for (const leg of legs) {
      if (leg.kind === "stock") {
        const dir = leg.action === "buy" ? 1 : -1;
        total += (S - leg.entryPrice) * leg.qty * dir;
      } else {
        const intrinsic = leg.kind === "call" ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
        const perShare = leg.action === "buy" ? (intrinsic - leg.premium) : (leg.premium - intrinsic);
        total += perShare * leg.qty * 100;
      }
    }
    return total;
  }

  // Encuentra los precios donde la curva de payoff cruza un umbral dado
  // (breakeven = cruce por 0; también sirve para un objetivo de ganancia > 0).
  function findCrossings(prices, payoffs, threshold) {
    const crossings = [];
    for (let i = 1; i < prices.length; i++) {
      const a = payoffs[i - 1] - threshold, b = payoffs[i] - threshold;
      if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) {
        const t = a === b ? 0 : (0 - a) / (b - a);
        crossings.push(round(prices[i - 1] + t * (prices[i] - prices[i - 1])));
      }
    }
    return crossings;
  }

  function computeStats(prices, payoffs) {
    const N = payoffs.length - 1;
    const maxProfit = Math.max(...payoffs);
    const maxLoss = Math.min(...payoffs);
    const breakevens = findCrossings(prices, payoffs, 0);

    // Only the upside (S -> infinity) can be truly unbounded, since price can't go below 0.
    // Detect a persistent non-zero slope at the right edge of the simulated range.
    const dRight = (payoffs[N] - payoffs[N - 1]) / (prices[N] - prices[N - 1]);
    const epsilon = 0.01; // $ payoff change per $1 of stock price
    const nearMax = Math.abs(payoffs[N] - maxProfit) < 1e-6;
    const nearMin = Math.abs(payoffs[N] - maxLoss) < 1e-6;

    const profitUnlimited = dRight > epsilon && nearMax;
    const lossUnlimited = dRight < -epsilon && nearMin;

    return { maxProfit, maxLoss, breakevens, profitUnlimited, lossUnlimited };
  }

  // Relación entre ganancia máxima y pérdida máxima, como referencia de control de riesgo.
  function riskRewardRatio(maxProfit, maxLoss, profitUnlimited, lossUnlimited) {
    if (profitUnlimited) return { ratio: null, label: "Ganancia ilimitada" };
    if (lossUnlimited) return { ratio: null, label: "Riesgo indefinido" };
    if (maxLoss === 0) return { ratio: null, label: "Sin riesgo" };
    const ratio = maxProfit / Math.abs(maxLoss);
    return { ratio, label: "1 : " + ratio.toFixed(2) };
  }

  // Cuántas veces se podría escalar la posición actual (multiplicando la cantidad
  // de cada leg por igual) sin superar el presupuesto de riesgo indicado.
  function suggestedMultiplier(maxLoss, lossUnlimited, riskBudget) {
    if (lossUnlimited) {
      return { multiplier: null, warning: "Riesgo indefinido: no se puede calcular un tamaño de posición basado en la pérdida máxima." };
    }
    if (maxLoss >= 0) {
      return { multiplier: null, warning: "Esta posición no tiene riesgo de pérdida en el rango simulado." };
    }
    const multiplier = Math.floor(riskBudget / Math.abs(maxLoss));
    return { multiplier, warning: null };
  }

  // % de ganancia objetivo por defecto, según reglas comunes de la industria:
  // en estrategias de ganancia ilimitada, un retorno sobre la prima pagada;
  // en estrategias de riesgo/beneficio definidos, un % de la ganancia máxima.
  function defaultProfitTargetPct(profitUnlimited) {
    return profitUnlimited ? 100 : 50;
  }

  // Monto en dólares que representa el objetivo de ganancia elegido.
  function profitTargetDollar(profitUnlimited, maxProfit, netCost, targetPct) {
    const basis = profitUnlimited ? Math.abs(netCost) : maxProfit;
    return basis * (targetPct / 100);
  }

  // Parsea el CSV de Alpha Vantage EARNINGS_CALENDAR (columnas: symbol,name,
  // reportDate,fiscalDateEnding,estimate,currency) y devuelve la fecha de
  // reporte futura más cercana para ese símbolo (YYYY-MM-DD), o null si no
  // hay ninguna en el horizonte pedido a la API.
  function parseEarningsCalendarCsv(csvText, symbol, todayIso) {
    const lines = (csvText || "").trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const symbolIdx = header.indexOf("symbol");
    const dateIdx = header.indexOf("reportdate");
    if (symbolIdx === -1 || dateIdx === -1) return null;

    const target = symbol.trim().toUpperCase();
    let nearest = null;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length <= Math.max(symbolIdx, dateIdx)) continue;
      if (cols[symbolIdx].trim().toUpperCase() !== target) continue;
      const rowDate = cols[dateIdx].trim();
      if (rowDate >= todayIso && (nearest === null || rowDate < nearest)) {
        nearest = rowDate;
      }
    }
    return nearest;
  }

  return {
    round,
    payoffAt,
    computeStats,
    findCrossings,
    riskRewardRatio,
    suggestedMultiplier,
    defaultProfitTargetPct,
    profitTargetDollar,
    parseEarningsCalendarCsv,
  };
});
