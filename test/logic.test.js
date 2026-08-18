const test = require("node:test");
const assert = require("node:assert/strict");
const { round, payoffAt, computeStats } = require("../logic.js");

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
