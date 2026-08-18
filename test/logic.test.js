const test = require("node:test");
const assert = require("node:assert/strict");
const {
  round,
  payoffAt,
  computeStats,
  findCrossings,
  riskRewardRatio,
  suggestedMultiplier,
  defaultProfitTargetPct,
  profitTargetDollar,
  parseEarningsCalendarCsv,
  daysUntil,
  earningsWithinDte,
  blackScholes,
  theoPayoffAt,
  positionGreeks,
} = require("../logic.js");

function priceRange(legs, hi) {
  const prices = [];
  const payoffs = [];
  for (let i = 0; i <= hi; i++) {
    prices.push(i);
    payoffs.push(payoffAt(legs, i));
  }
  return { prices, payoffs };
}

test("round redondea a 2 decimales", () => {
  assert.equal(round(1.234), 1.23);
  assert.equal(round(1.236), 1.24);
  assert.equal(round(100), 100);
});

test("payoffAt: long call limita la pérdida a la prima pagada", () => {
  const legs = [{ kind: "call", action: "buy", strike: 100, premium: 3, qty: 1 }];
  assert.equal(payoffAt(legs, 100), -300); // vence sin valor: se pierde toda la prima
  assert.equal(payoffAt(legs, 80), -300); // muy por debajo del strike, misma pérdida máxima
  assert.equal(payoffAt(legs, 110), 700); // (110-100-3) * 1 * 100
});

test("payoffAt: short put genera crédito y pérdida si el precio cae", () => {
  const legs = [{ kind: "put", action: "sell", strike: 100, premium: 3, qty: 1 }];
  assert.equal(payoffAt(legs, 100), 300); // vence sin valor: se queda con toda la prima
  assert.equal(payoffAt(legs, 90), -700); // (3 - 10) * 1 * 100
});

test("payoffAt: posición de acciones (stock) escala con la cantidad y dirección", () => {
  const longStock = [{ kind: "stock", action: "buy", entryPrice: 100, qty: 100 }];
  assert.equal(payoffAt(longStock, 110), 1000);

  const shortStock = [{ kind: "stock", action: "sell", entryPrice: 100, qty: 100 }];
  assert.equal(payoffAt(shortStock, 110), -1000);
});

test("payoffAt: suma varias legs (bull call spread)", () => {
  const legs = [
    { kind: "call", action: "buy", strike: 100, premium: 3, qty: 1 },
    { kind: "call", action: "sell", strike: 110, premium: 1.5, qty: 1 },
  ];
  assert.equal(payoffAt(legs, 100), -150); // débito neto pagado: (3-1.5)*100
  assert.equal(payoffAt(legs, 120), 850); // ganancia máxima: (110-100-1.5)*100
  assert.equal(payoffAt(legs, 150), 850); // se mantiene tope aunque suba más
});

test("computeStats: encuentra el breakeven y la pérdida máxima de un long call", () => {
  const legs = [{ kind: "call", action: "buy", strike: 100, premium: 3, qty: 1 }];
  const prices = [];
  const payoffs = [];
  for (let i = 0; i <= 200; i++) {
    const S = 200 * (i / 200); // 0..200
    prices.push(S);
    payoffs.push(payoffAt(legs, S));
  }
  const stats = computeStats(prices, payoffs);

  assert.equal(stats.maxLoss, -300);
  assert.equal(stats.profitUnlimited, true);
  assert.equal(stats.lossUnlimited, false);
  assert.equal(stats.breakevens.length, 1);
  assert.ok(Math.abs(stats.breakevens[0] - 103) < 1); // strike + prima
});

test("findCrossings: encuentra dónde el payoff cruza un objetivo de ganancia (no solo cero)", () => {
  const legs = [
    { kind: "call", action: "buy", strike: 100, premium: 3, qty: 1 },
    { kind: "call", action: "sell", strike: 110, premium: 1.5, qty: 1 },
  ];
  const { prices, payoffs } = priceRange(legs, 200);
  // Entre S=100 (-150) y S=110 (850) el payoff es lineal: 100*(S-101.5).
  // Cruza $425 (50% del máximo) en S=105.75.
  const crossings = findCrossings(prices, payoffs, 425);
  assert.equal(crossings.length, 1);
  assert.ok(Math.abs(crossings[0] - 105.75) < 0.1);
});

test("riskRewardRatio: bounded, ganancia ilimitada y riesgo indefinido", () => {
  assert.equal(riskRewardRatio(850, -150, false, false).ratio, 850 / 150);
  assert.equal(riskRewardRatio(850, -150, false, false).label, "1 : " + (850 / 150).toFixed(2));

  const unlimitedProfit = riskRewardRatio(Infinity, -300, true, false);
  assert.equal(unlimitedProfit.ratio, null);
  assert.equal(unlimitedProfit.label, "Ganancia ilimitada");

  const unlimitedLoss = riskRewardRatio(300, -Infinity, false, true);
  assert.equal(unlimitedLoss.ratio, null);
  assert.equal(unlimitedLoss.label, "Riesgo indefinido");
});

test("suggestedMultiplier: escala la posición según el presupuesto de riesgo", () => {
  // Pérdida máxima -$300 por unidad, presupuesto de riesgo $1000 → alcanza para 3x.
  assert.equal(suggestedMultiplier(-300, false, 1000).multiplier, 3);
  assert.equal(suggestedMultiplier(-300, false, 1000).warning, null);

  const undefinedRisk = suggestedMultiplier(-300, true, 1000);
  assert.equal(undefinedRisk.multiplier, null);
  assert.ok(undefinedRisk.warning);
});

test("defaultProfitTargetPct y profitTargetDollar", () => {
  assert.equal(defaultProfitTargetPct(true), 100); // ganancia ilimitada → % de retorno sobre la prima
  assert.equal(defaultProfitTargetPct(false), 50); // riesgo/beneficio definido → % de la ganancia máxima

  // Long call: ganancia ilimitada, prima pagada $300 → objetivo 100% = $300.
  assert.equal(profitTargetDollar(true, Infinity, -300, 100), 300);
  // Bull call spread: ganancia máxima $850 → objetivo 50% = $425.
  assert.equal(profitTargetDollar(false, 850, -150, 50), 425);
});

test("parseEarningsCalendarCsv: encuentra el próximo reporte de un símbolo", () => {
  const csv = [
    "symbol,name,reportDate,fiscalDateEnding,estimate,currency",
    "AAPL,Apple Inc,2026-01-29,2025-12-31,2.35,USD",
    "AAPL,Apple Inc,2026-04-30,2026-03-31,1.65,USD",
    "MSFT,Microsoft Corp,2026-01-27,2025-12-31,3.10,USD",
  ].join("\n");

  assert.equal(parseEarningsCalendarCsv(csv, "AAPL", "2026-01-01"), "2026-01-29");
  // Pasada la primera fecha, debe encontrar la siguiente.
  assert.equal(parseEarningsCalendarCsv(csv, "AAPL", "2026-02-01"), "2026-04-30");
  // Símbolo distinto no debe confundirse.
  assert.equal(parseEarningsCalendarCsv(csv, "MSFT", "2026-01-01"), "2026-01-27");
  // Símbolo sin filas → null.
  assert.equal(parseEarningsCalendarCsv(csv, "TSLA", "2026-01-01"), null);
  // Sin fechas futuras en el horizonte → null.
  assert.equal(parseEarningsCalendarCsv(csv, "AAPL", "2026-05-01"), null);
});

test("blackScholes: coincide con los valores de referencia del ejemplo clásico (S=K=100, T=1, r=5%, sigma=20%)", () => {
  const call = blackScholes(100, 100, 1, 0.05, 0.2, "call");
  const put = blackScholes(100, 100, 1, 0.05, 0.2, "put");

  assert.ok(Math.abs(call.price - 10.45) < 0.01, `call.price=${call.price}`);
  assert.ok(Math.abs(put.price - 5.57) < 0.01, `put.price=${put.price}`);
  assert.ok(Math.abs(call.delta - 0.6368) < 0.001, `call.delta=${call.delta}`);
  assert.ok(Math.abs(put.delta - (-0.3632)) < 0.001, `put.delta=${put.delta}`);

  // Put-call parity: C - P = S - K*e^(-rT)
  const parityLhs = call.price - put.price;
  const parityRhs = 100 - 100 * Math.exp(-0.05 * 1);
  assert.ok(Math.abs(parityLhs - parityRhs) < 0.01);

  // Gamma y vega son iguales para call y put al mismo strike/vencimiento.
  assert.ok(Math.abs(call.gamma - put.gamma) < 1e-9);
  assert.ok(Math.abs(call.vega - put.vega) < 1e-9);
});

test("blackScholes: con T=0 converge al valor intrínseco (igual que payoffAt al vencimiento)", () => {
  const itmCall = blackScholes(110, 100, 0, 0.05, 0.2, "call");
  assert.equal(itmCall.price, 10);
  assert.equal(itmCall.delta, 1);

  const otmPut = blackScholes(110, 100, 0, 0.05, 0.2, "put");
  assert.equal(otmPut.price, 0);
  assert.equal(otmPut.delta, 0);
});

test("theoPayoffAt: con T=0 da el mismo resultado que payoffAt", () => {
  const legs = [
    { kind: "call", action: "buy", strike: 100, premium: 3, qty: 1 },
    { kind: "call", action: "sell", strike: 110, premium: 1.5, qty: 1 },
  ];
  for (const S of [80, 100, 105, 110, 130]) {
    assert.equal(theoPayoffAt(legs, S, 0, 0.05, 0.2), payoffAt(legs, S));
  }
});

test("positionGreeks: delta de una acción larga es su cantidad; long call tiene delta positivo", () => {
  const stockLegs = [{ kind: "stock", action: "buy", entryPrice: 100, qty: 100 }];
  assert.equal(positionGreeks(stockLegs, 100, 0.1, 0.05, 0.2).delta, 100);

  const callLegs = [{ kind: "call", action: "buy", strike: 100, premium: 3, qty: 1 }];
  const g = positionGreeks(callLegs, 100, 30 / 365, 0.05, 0.3);
  assert.ok(g.delta > 0 && g.delta < 100, `delta=${g.delta}`); // delta * 100 acciones, entre 0 y 1 por acción
  assert.ok(g.theta < 0, `theta=${g.theta}`); // comprar opciones pierde valor con el paso del tiempo
});

test("daysUntil: cuenta días de calendario entre dos fechas ISO", () => {
  assert.equal(daysUntil("2026-08-25", "2026-08-18"), 7);
  assert.equal(daysUntil("2026-08-18", "2026-08-18"), 0);
  assert.equal(daysUntil("2026-08-10", "2026-08-18"), -8); // fecha pasada → negativo
});

test("earningsWithinDte: detecta si el próximo earnings cae dentro de la ventana de vencimiento", () => {
  // Earnings en 7 días, posición a 30 días → cae dentro de la ventana.
  const within = earningsWithinDte("2026-08-25", "2026-08-18", 30);
  assert.equal(within.within, true);
  assert.equal(within.daysUntilEarnings, 7);

  // Earnings en 45 días, posición a 30 días → no llega a cubrirlo.
  const outside = earningsWithinDte("2026-10-02", "2026-08-18", 30);
  assert.equal(outside.within, false);

  // Sin fecha de earnings conocida → nunca "within".
  assert.equal(earningsWithinDte(null, "2026-08-18", 30).within, false);

  // Earnings ya pasado (no debería pasar en la práctica, pero por robustez).
  assert.equal(earningsWithinDte("2026-08-01", "2026-08-18", 30).within, false);
});
