import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { handlePipedEmail } from '../src/pipeHandler.js';
import { EmailParseError } from '../src/emailParser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const cfg = {
  spliit: {
    groupId: 'group',
    paidById: 'payer',
    participantIds: ['payer', 'other'],
  },
  telegram: {
    botToken: 'bot-token',
    chatId: 'chat-id',
  },
  logFile: '/tmp/spliit-pipe-test.log',
};

describe('handlePipedEmail', () => {
  it('returns 0 for parse failures while logging and alerting Telegram', async () => {
    const raw = fixture('failed.eml');
    const logs = [];
    const fetchCalls = [];

    const exitCode = await handlePipedEmail(raw, cfg, {
      parseFn: async (input) => {
        assert.equal(input, raw);
        throw new EmailParseError('Could not parse transaction from email body');
      },
      logFn: async (_logFile, level, message) => {
        logs.push({ level, message });
      },
      fetchFn: async (url, options) => {
        fetchCalls.push({ url, options });
        return { ok: true, json: async () => ({ ok: true }) };
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(logs[0].level, 'error');
    assert.match(logs[0].message, /Could not parse transaction/);
    assert.equal(fetchCalls.length, 1);
    assert.ok(String(fetchCalls[0].url).includes('/sendMessage'));
  });

  it('returns 1 for downstream processing failures', async () => {
    const logs = [];
    const fetchCalls = [];

    const exitCode = await handlePipedEmail('raw email', cfg, {
      parseFn: async () => ({
        channel: 'test',
        cardLast4: null,
        date: new Date('2026-06-29T00:00:00.000Z'),
        type: 'Payment',
        amount: 1,
        currency: 'HKD',
        merchantRaw: 'TEST MERCHANT',
      }),
      processor: async () => {
        throw new Error('Spliit exploded');
      },
      logFn: async (_logFile, level, message) => {
        logs.push({ level, message });
      },
      fetchFn: async (url, options) => {
        fetchCalls.push({ url, options });
        return { ok: true, json: async () => ({ ok: true }) };
      },
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(logs[0], { level: 'error', message: 'Spliit exploded' });
    assert.equal(fetchCalls.length, 1);
  });
});
