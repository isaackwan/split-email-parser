const FRANKFURTER_BASE = 'https://api.frankfurter.app';

/**
 * Converts an amount from a given currency to CAD using the Frankfurter API
 * (https://frankfurter.app — free, no key required).
 *
 * Returns the original amount unchanged when the source currency is already CAD.
 *
 * The `fetchFn` parameter enables full dependency injection for unit tests;
 * production code leaves it as the default global fetch.
 *
 * @param {number}   amount       - Amount in source currency
 * @param {string}   fromCurrency - ISO 4217 source currency code
 * @param {function} [fetchFn]    - fetch-compatible function (injectable for tests)
 * @returns {Promise<ConversionResult>}
 *
 * @typedef {{ cadAmount: number, rate: number }} ConversionResult
 */
export async function convertToCAD(amount, fromCurrency, fetchFn = globalThis.fetch) {
  if (fromCurrency === 'CAD') {
    return { cadAmount: amount, rate: 1 };
  }

  const url = `${FRANKFURTER_BASE}/latest?from=${encodeURIComponent(fromCurrency)}&to=CAD`;
  const response = await fetchFn(url);

  if (!response.ok) {
    throw new Error(
      `Currency conversion failed for ${fromCurrency}→CAD: HTTP ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  const rate = data?.rates?.CAD;

  if (typeof rate !== 'number') {
    throw new Error(
      `Frankfurter API returned no CAD rate for ${fromCurrency}. Response: ${JSON.stringify(data)}`
    );
  }

  return {
    cadAmount: amount * rate,
    rate,
  };
}
