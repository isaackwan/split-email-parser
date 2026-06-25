import { Hono } from 'hono';

import { parseGoogleWalletNotification } from './googleWalletParser.js';
import { sendTelegram, formatErrorMessage } from './telegram.js';
import { log as fileLog } from './logger.js';
import { processTransaction } from './transactionProcessor.js';

export function createWebApp({
  cfg,
  fetchFn = globalThis.fetch,
  logFn = fileLog,
  processor = processTransaction,
} = {}) {
  const app = new Hono();

  app.post('/submit1', async (c) => {
    let payload;
    try {
      payload = await c.req.json();
    } catch (err) {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    let tx;
    try {
      tx = parseGoogleWalletNotification(payload);
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }

    if (!tx) {
      return c.body(null, 204);
    }

    try {
      await processor(tx, cfg, {
        sourceLabel: 'Google Wallet notification',
        fetchFn,
        logFn,
      });
      return c.json({ ok: true }, 201);
    } catch (err) {
      await logFn(cfg?.logFile, 'error', err.message, { stack: err.stack });

      try {
        await sendTelegram(
          cfg.telegram.botToken,
          cfg.telegram.chatId,
          formatErrorMessage(err, JSON.stringify(payload)),
          fetchFn
        );
      } catch (telegramErr) {
        await logFn(cfg?.logFile, 'error', 'Failed to send Telegram error alert', {
          error: telegramErr.message,
        });
      }

      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  app.all('*', (c) => c.json({ error: 'Method not allowed' }, 405));

  return app;
}
