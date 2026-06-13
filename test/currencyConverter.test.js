import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { convertToCAD } from '../src/currencyConverter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a mock fetch that returns a successful Frankfurter-style response */
function mockFrankfurter(rate) {
  return async (_url) => ({
    ok: true,
    json: async () => ({ base: 'HKD', rates: { CAD: rate } }),
  });
}

/** Creates a mock fetch that returns an HTTP error */
function mockHttpError(status, statusText) {
  return async (_url) => ({
    ok: false,
    status,
    statusText,
    text: async () => 'Internal Server Error',
  });
}

/** Creates a mock fetch that returns a response with no CAD field */
function mockMissingRate() {
  return async (_url) => ({
    ok: true,
    json: async () => ({ base: 'HKD', rates: {} }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('convertToCAD', () => {
  it('returns the original amount with rate 1 when already CAD', async () => {
    // Should never call the network
    const neverFetch = async () => { throw new Error('should not fetch'); };
    const result = await convertToCAD(42.5, 'CAD', neverFetch);

    assert.equal(result.cadAmount, 42.5);
    assert.equal(result.rate, 1);
  });

  it('converts HKD to CAD using the fetched rate', async () => {
    const result = await convertToCAD(100, 'HKD', mockFrankfurter(0.18));

    assert.equal(result.cadAmount, 18); // 100 × 0.18
    assert.equal(result.rate, 0.18);
  });

  it('converts USD to CAD using the fetched rate', async () => {
    const fetchFn = async (_url) => ({
      ok: true,
      json: async () => ({ base: 'USD', rates: { CAD: 1.36 } }),
    });

    const result = await convertToCAD(10, 'USD', fetchFn);

    // Use toFixed comparison to avoid floating-point representation issues
    // (10 × 1.36 in IEEE 754 is 13.600000000000001)
    assert.equal(result.cadAmount.toFixed(2), '13.60');
    assert.equal(result.rate, 1.36);
  });

  it('passes the correct currency code in the URL', async () => {
    let capturedUrl;
    const captureFetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ rates: { CAD: 0.5 } }),
      };
    };

    await convertToCAD(1, 'HKD', captureFetch);

    assert.ok(capturedUrl.includes('from=HKD'), `URL should include from=HKD, got: ${capturedUrl}`);
    assert.ok(capturedUrl.includes('to=CAD'), `URL should include to=CAD, got: ${capturedUrl}`);
  });

  it('throws on a non-OK HTTP response', async () => {
    await assert.rejects(
      () => convertToCAD(10, 'HKD', mockHttpError(503, 'Service Unavailable')),
      /Currency conversion failed/
    );
  });

  it('throws when the CAD rate is absent from the response', async () => {
    await assert.rejects(
      () => convertToCAD(10, 'HKD', mockMissingRate()),
      /no CAD rate/
    );
  });

  it('preserves floating-point precision for small amounts', async () => {
    // 0.03 HKD × 0.18 = 0.0054 — should not throw or round to zero
    const result = await convertToCAD(0.03, 'HKD', mockFrankfurter(0.18));

    assert.ok(result.cadAmount > 0, 'cadAmount should be positive');
    assert.ok(result.cadAmount < 0.01, 'cadAmount should be tiny');
  });
});
