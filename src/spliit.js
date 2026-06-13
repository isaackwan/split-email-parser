const SPLIIT_API_URL =
  'https://spliit.app/api/trpc/groups.expenses.create?batch=1';

/**
 * Creates an expense entry in a Spliit group via the tRPC batch endpoint.
 *
 * Amount is converted to integer cents (× 100, rounded) because that is what
 * Spliit's backend stores.  All participants receive equal shares; the
 * `splitMode: "EVENLY"` field makes the share values irrelevant to the final
 * split — they are set to 100 each to match the format Spliit's own UI emits.
 *
 * The `fetchFn` parameter enables dependency injection for unit tests.
 *
 * @param {CreateExpenseParams} params
 * @param {function} [fetchFn]
 * @returns {Promise<object>} Raw tRPC response
 *
 * @typedef {{
 *   groupId:        string,
 *   paidById:       string,
 *   participantIds: string[],
 *   title:          string,
 *   cadAmount:      number,
 *   expenseDate:    Date,
 *   notes:          string,
 * }} CreateExpenseParams
 */
export async function createExpense(params, fetchFn = globalThis.fetch) {
  const {
    groupId,
    paidById,
    participantIds,
    title,
    cadAmount,
    expenseDate,
    notes,
  } = params;

  // Spliit stores amounts as integer cents
  const amountCents = Math.round(cadAmount * 100);

  const body = {
    '0': {
      json: {
        groupId,
        expenseFormValues: {
          expenseDate: expenseDate.toISOString(),
          title,
          category: 0,
          amount: amountCents,
          conversionRate: null,
          paidBy: paidById,
          paidFor: participantIds.map((id) => ({ participant: id, shares: 100 })),
          splitMode: 'EVENLY',
          saveDefaultSplittingOptions: false,
          isReimbursement: false,
          documents: [],
          notes,
          recurrenceRule: 'NONE',
        },
        participantId: paidById,
      },
      // tRPC superjson metadata: tells the server to deserialise expenseDate as
      // a Date object and treat conversionRate as undefined (not null).
      meta: {
        values: {
          'expenseFormValues.expenseDate': ['Date'],
          'expenseFormValues.conversionRate': ['undefined'],
        },
      },
    },
  };

  const response = await fetchFn(SPLIIT_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '(unreadable body)');
    throw new Error(
      `Spliit API error: HTTP ${response.status} ${response.statusText}\n${detail}`
    );
  }

  return response.json();
}
