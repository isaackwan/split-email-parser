import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createWebApp } from '../src/webApp.js';

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
  logFile: '/tmp/spliit-test.log',
};

const payment = {
  packageName: 'com.google.android.apps.walletnfcrel',
  title: 'S F EXPRESS HONG KONG',
  text: 'HK$17.00 with hsbchk emtwoo',
  postedAt: 1782354559394,
};

function jsonRequest(method, body) {
  return new Request('http://localhost/nodejs-ignore-20260613/submit1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('createWebApp', () => {
  it('returns 204 for ignored notifications', async () => {
    let calls = 0;
    const app = createWebApp({
      cfg,
      processor: async () => {
        calls += 1;
      },
    });

    const res = await app.request(jsonRequest('POST', {
      ...payment,
      title: 'Preparing your receipt',
      text: "We're adding the location to your receipt",
    }));

    assert.equal(res.status, 204);
    assert.equal(calls, 0);
  });

  it('returns 201 for parsed payments', async () => {
    let capturedTx;
    const app = createWebApp({
      cfg,
      processor: async (tx) => {
        capturedTx = tx;
      },
    });

    const res = await app.request(jsonRequest('POST', payment));

    assert.equal(res.status, 201);
    assert.equal(capturedTx.merchantRaw, 'S F EXPRESS HONG KONG');
    assert.equal(capturedTx.amount, 17);
    assert.equal(capturedTx.currency, 'HKD');
  });

  it('returns 400 for invalid JSON', async () => {
    const app = createWebApp({ cfg });
    const res = await app.request(new Request('http://localhost/nodejs-ignore-20260613/submit1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    }));

    assert.equal(res.status, 400);
  });

  it('returns 400 for ambiguous currency', async () => {
    const app = createWebApp({ cfg });
    const res = await app.request(jsonRequest('POST', {
      ...payment,
      text: '$17.00 with hsbchk emtwoo',
    }));

    assert.equal(res.status, 400);
    assert.match(await res.text(), /Ambiguous/);
  });

  it('returns 405 for non-POST requests', async () => {
    const app = createWebApp({ cfg });
    const res = await app.request('http://localhost/nodejs-ignore-20260613/submit1');

    assert.equal(res.status, 405);
  });

  it('returns 500 and sends a Telegram alert when processing fails', async () => {
    const fetchCalls = [];
    const logs = [];
    const app = createWebApp({
      cfg,
      processor: async () => {
        throw new Error('Spliit exploded');
      },
      fetchFn: async (url, options) => {
        fetchCalls.push({ url, options });
        return { ok: true, json: async () => ({ ok: true }) };
      },
      logFn: async (_logFile, level, message) => {
        logs.push({ level, message });
      },
    });

    const res = await app.request(jsonRequest('POST', payment));

    assert.equal(res.status, 500);
    assert.equal(logs[0].level, 'error');
    assert.equal(logs[0].message, 'Spliit exploded');
    assert.equal(fetchCalls.length, 1);
    assert.ok(String(fetchCalls[0].url).includes('/sendMessage'));
  });
});
