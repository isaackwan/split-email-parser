/**
 * Sends a message to a Telegram chat via the Bot API.
 *
 * @param {string}   botToken
 * @param {string}   chatId
 * @param {string}   message  - HTML-formatted message text
 * @param {function} [fetchFn]
 * @returns {Promise<object>}
 */
export async function sendTelegram(botToken, chatId, message, fetchFn = globalThis.fetch) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '(unreadable body)');
    throw new Error(
      `Telegram API error: HTTP ${response.status} ${response.statusText}\n${detail}`
    );
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Message formatters
// Pure functions — easy to test without any I/O.
// ---------------------------------------------------------------------------

/**
 * Formats a success notification after an expense is created.
 *
 * @param {import('./emailParser.js').Transaction} tx
 * @param {number} cadAmount
 * @param {number} rate
 * @returns {string}
 */
export function formatSuccessMessage(tx, cadAmount, rate) {
  const originalAmountStr = `${tx.currency} ${tx.amount.toFixed(2)}`;
  const cadStr = `CAD ${cadAmount.toFixed(2)}`;
  const rateNote =
    tx.currency !== 'CAD'
      ? ` @ 1 ${tx.currency} = ${rate.toFixed(4)} CAD`
      : '';

  // Date displayed in HKT for readability (bank is HK-based)
  const dateHKT = tx.date
    .toLocaleString('en-HK', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .replace(',', '');

  return [
    '💳 <b>New expense added to Spliit</b>',
    '',
    `📍 ${escapeHtml(tx.merchantRaw)}`,
    `💰 ${originalAmountStr} → ${cadStr}${rateNote}`,
    `🃏 Card ****${tx.cardLast4}`,
    `📅 ${dateHKT} HKT`,
    `🏷 ${tx.type}`,
  ].join('\n');
}

/**
 * Formats an error notification when the parser or downstream calls fail.
 *
 * @param {Error}  error
 * @param {string} rawEmailSnippet – first ~200 chars of the raw email for context
 * @returns {string}
 */
export function formatErrorMessage(error, rawEmailSnippet) {
  return [
    '❌ <b>Email parser failed</b>',
    '',
    `<code>${escapeHtml(error.message)}</code>`,
    '',
    `<b>Email snippet:</b>`,
    `<code>${escapeHtml(rawEmailSnippet.slice(0, 300))}</code>`,
  ].join('\n');
}

/**
 * Escapes characters that have special meaning in Telegram's HTML mode.
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
