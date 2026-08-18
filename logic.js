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

  function computeStats(prices, payoffs) {
    const N = payoffs.length - 1;
    const maxProfit = Math.max(...payoffs);
    const maxLoss = Math.min(...payoffs);

    // breakevens: sign changes
    const breakevens = [];
    for (let i = 1; i < prices.length; i++) {
      const a = payoffs[i - 1], b = payoffs[i];
      if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) {
        const t = a === b ? 0 : (0 - a) / (b - a);
        breakevens.push(round(prices[i - 1] + t * (prices[i] - prices[i - 1])));
      }
    }

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

  return { round, payoffAt, computeStats };
});
