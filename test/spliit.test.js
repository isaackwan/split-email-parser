import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createExpense } from '../src/spliit.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_PARAMS = {
  groupId: 'test-group-id',
  paidById: 'participant-A',
  participantIds: ['participant-A', 'participant-B', 'participant-C'],
  title: 'TEST MERCHANT',
  cadAmount: 12.39,
  expenseDate: new Date('2026-06-12T08:08:11.788Z'),
  notes: 'test notes',
};

/** Captures the request body and returns a successful response */
function captureFetch() {
  let captured = null;
  const fetchFn = async (_url, options) => {
    captured = { url: _url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ result: { data: { json: {} } } }) };
  };
  fetchFn.getCaptured = () => captured;
  return fetchFn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('createExpense', () => {
  it('sends a POST to the correct Spliit tRPC endpoint', async () => {
    const fetch = captureFetch();
    await createExpense(BASE_PARAMS, fetch);

    assert.equal(
      fetch.getCaptured().url,
      'https://spliit.app/api/trpc/groups.expenses.create?batch=1'
    );
  });

  it('converts cadAmount to integer cents', async () => {
    const fetch = captureFetch();
    await createExpense({ ...BASE_PARAMS, cadAmount: 12.39 }, fetch);

    assert.equal(fetch.getCaptured().body['0'].json.expenseFormValues.amount, 1239);
  });

  it('rounds cadAmount to the nearest cent', async () => {
    const fetch = captureFetch();
    await createExpense({ ...BASE_PARAMS, cadAmount: 0.0054 }, fetch);

    // Math.round(0.0054 * 100) = Math.round(0.54) = 1
    assert.equal(fetch.getCaptured().body['0'].json.expenseFormValues.amount, 1);
  });

  it('uses the provided groupId', async () => {
    const fetch = captureFetch();
    await createExpense(BASE_PARAMS, fetch);

    assert.equal(fetch.getCaptured().body['0'].json.groupId, 'test-group-id');
  });

  it('sets paidBy to paidById', async () => {
    const fetch = captureFetch();
    await createExpense(BASE_PARAMS, fetch);

    const { expenseFormValues } = fetch.getCaptured().body['0'].json;
    assert.equal(expenseFormValues.paidBy, 'participant-A');
  });

  it('includes all participants in paidFor with shares: 100', async () => {
    const fetch = captureFetch();
    await createExpense(BASE_PARAMS, fetch);

    const { paidFor } = fetch.getCaptured().body['0'].json.expenseFormValues;
    assert.deepEqual(paidFor, [
      { participant: 'participant-A', shares: 100 },
      { participant: 'participant-B', shares: 100 },
      { participant: 'participant-C', shares: 100 },
    ]);
  });

  it('deduplicates paidFor participants', async () => {
    const fetch = captureFetch();
    await createExpense(
      {
        ...BASE_PARAMS,
        participantIds: [
          'participant-A',
          'participant-B',
          'participant-A',
          'participant-C',
          'participant-B',
        ],
      },
      fetch
    );

    const { paidFor } = fetch.getCaptured().body['0'].json.expenseFormValues;
    assert.deepEqual(paidFor, [
      { participant: 'participant-A', shares: 100 },
      { participant: 'participant-B', shares: 100 },
      { participant: 'participant-C', shares: 100 },
    ]);
  });

  it('sets splitMode to EVENLY', async () => {
    const fetch = captureFetch();
    await createExpense(BASE_PARAMS, fetch);

    assert.equal(
      fetch.getCaptured().body['0'].json.expenseFormValues.splitMode,
      'EVENLY'
    );
  });

  it('serialises expenseDate as an ISO string', async () => {
    const fetch = captureFetch();
    const date = new Date('2026-06-12T08:08:11.788Z');
    await createExpense({ ...BASE_PARAMS, expenseDate: date }, fetch);

    assert.equal(
      fetch.getCaptured().body['0'].json.expenseFormValues.expenseDate,
      '2026-06-12T08:08:11.788Z'
    );
  });

  it('includes tRPC superjson meta for expenseDate and conversionRate', async () => {
    const fetch = captureFetch();
    await createExpense(BASE_PARAMS, fetch);

    const { meta } = fetch.getCaptured().body['0'];
    assert.deepEqual(meta.values['expenseFormValues.expenseDate'], ['Date']);
    assert.deepEqual(meta.values['expenseFormValues.conversionRate'], ['undefined']);
  });

  it('uses the title as the expense title', async () => {
    const fetch = captureFetch();
    await createExpense({ ...BASE_PARAMS, title: 'MY MERCHANT ABC' }, fetch);

    assert.equal(
      fetch.getCaptured().body['0'].json.expenseFormValues.title,
      'MY MERCHANT ABC'
    );
  });

  it('throws on a non-OK HTTP response', async () => {
    const failFetch = async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'Invalid group',
    });

    await assert.rejects(
      () => createExpense(BASE_PARAMS, failFetch),
      /Spliit API error/
    );
  });
});
