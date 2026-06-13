import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sendTelegram,
  formatSuccessMessage,
  formatErrorMessage,
  escapeHtml,
} from '../src/telegram.js';
import { TRANSACTION_TYPES } from '../src/emailParser.js';

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------
describe('escapeHtml', () => {
  it('escapes ampersands', () => assert.equal(escapeHtml('a&b'), 'a&amp;b'));
  it('escapes less-than', () => assert.equal(escapeHtml('a<b'), 'a&lt;b'));
  it('escapes greater-than', () => assert.equal(escapeHtml('a>b'), 'a&gt;b'));
  it('leaves plain text untouched', () =>
    assert.equal(escapeHtml('hello world'), 'hello world'));
  it('handles merchant names with special chars', () =>
    assert.equal(escapeHtml('H&M STORE'), 'H&amp;M STORE'));
  it('coerces non-strings', () =>
    assert.equal(escapeHtml(42), '42'));
});

// ---------------------------------------------------------------------------
// formatSuccessMessage
// ---------------------------------------------------------------------------
describe('formatSuccessMessage', () => {
  const baseTransaction = {
    cardLast4: '3498',
    date: new Date('2026-06-01T08:19:00.000Z'), // 16:19 HKT
    type: TRANSACTION_TYPES.PURCHASE,
    amount: 2.3,
    currency: 'HKD',
    merchantRaw: 'HONG KONG TRAMWAY',
  };

  it('contains the merchant name', () => {
    const msg = formatSuccessMessage(baseTransaction, 0.4, 0.1756);
    assert.ok(msg.includes('HONG KONG TRAMWAY'));
  });

  it('shows original currency and amount', () => {
    const msg = formatSuccessMessage(baseTransaction, 0.4, 0.1756);
    assert.ok(msg.includes('HKD 2.30'), `expected "HKD 2.30" in: ${msg}`);
  });

  it('shows the CAD amount', () => {
    const msg = formatSuccessMessage(baseTransaction, 0.4, 0.1756);
    assert.ok(msg.includes('CAD 0.40'), `expected "CAD 0.40" in: ${msg}`);
  });

  it('shows the exchange rate for non-CAD transactions', () => {
    const msg = formatSuccessMessage(baseTransaction, 0.4, 0.1756);
    assert.ok(msg.includes('0.1756'), `expected rate in: ${msg}`);
  });

  it('omits the exchange rate when currency is already CAD', () => {
    const cadTx = { ...baseTransaction, currency: 'CAD', amount: 50 };
    const msg = formatSuccessMessage(cadTx, 50, 1);
    assert.ok(!msg.includes('@ 1'), `should not show rate for CAD in: ${msg}`);
  });

  it('shows the card last-4 digits', () => {
    const msg = formatSuccessMessage(baseTransaction, 0.4, 0.1756);
    assert.ok(msg.includes('3498'));
  });

  it('escapes HTML in the merchant name', () => {
    const tx = { ...baseTransaction, merchantRaw: 'H&M <STORE>' };
    const msg = formatSuccessMessage(tx, 0.4, 0.1756);
    assert.ok(msg.includes('H&amp;M'), `expected escaped & in: ${msg}`);
    assert.ok(msg.includes('&lt;STORE&gt;'), `expected escaped <> in: ${msg}`);
  });
});

// ---------------------------------------------------------------------------
// formatErrorMessage
// ---------------------------------------------------------------------------
describe('formatErrorMessage', () => {
  it('contains the error message', () => {
    const err = new Error('Could not parse transaction');
    const msg = formatErrorMessage(err, 'Subject: test\r\n\r\nbody');
    assert.ok(msg.includes('Could not parse transaction'));
  });

  it('contains a snippet of the raw email', () => {
    const err = new Error('parse failed');
    const msg = formatErrorMessage(err, 'From: bank@example.com\r\n\r\nbody text');
    assert.ok(msg.includes('From: bank@example.com'));
  });

  it('truncates very long email snippets to 300 chars', () => {
    const err = new Error('x');
    const longEmail = 'A'.repeat(1000);
    const msg = formatErrorMessage(err, longEmail);
    // The snippet inside the message should not exceed 300 'A's
    const aaCount = (msg.match(/A/g) || []).length;
    assert.ok(aaCount <= 300, `snippet too long: ${aaCount} chars`);
  });

  it('escapes HTML in the error message', () => {
    const err = new Error('error with <html> & stuff');
    const msg = formatErrorMessage(err, '');
    assert.ok(msg.includes('&lt;html&gt;'));
    assert.ok(msg.includes('&amp;'));
  });
});

// ---------------------------------------------------------------------------
// sendTelegram
// ---------------------------------------------------------------------------
describe('sendTelegram', () => {
  it('sends a POST with the correct structure', async () => {
    let captured;
    const mockFetch = async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ ok: true }) };
    };

    await sendTelegram('BOT_TOKEN', 'CHAT_ID', 'hello', mockFetch);

    assert.ok(captured.url.includes('BOT_TOKEN'));
    assert.ok(captured.url.includes('sendMessage'));
    assert.equal(captured.body.chat_id, 'CHAT_ID');
    assert.equal(captured.body.text, 'hello');
    assert.equal(captured.body.parse_mode, 'HTML');
  });

  it('throws on a non-OK HTTP response', async () => {
    const failFetch = async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid token',
    });

    await assert.rejects(
      () => sendTelegram('bad-token', '123', 'msg', failFetch),
      /Telegram API error/
    );
  });
});
