'use strict';
(function exposeMarketPricing(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProImportMarketPricing = api;
})(typeof globalThis === 'object' ? globalThis : this, function createMarketPricing() {
  function aboveMeanPriceGroup(values) {
    const prices = values.map(Number).filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    if (!prices.length) return null;

    const average = list => list.reduce((sum, price) => sum + price, 0) / list.length;
    const baselineAverage = average(prices);
    let aboveAverage = prices.filter(price => price > baselineAverage);
    if (!aboveAverage.length) aboveAverage = prices;

    return {
      min: aboveAverage[0],
      max: aboveAverage[aboveAverage.length - 1],
      average: average(aboveAverage),
      baselineAverage,
      count: aboveAverage.length,
      total: prices.length,
      belowAverageCount: prices.length - aboveAverage.length,
    };
  }

  return { aboveMeanPriceGroup };
});
