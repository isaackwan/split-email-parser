/**
 * Entry point — invoked by wrapper.sh when cPanel pipes an email to this script.
 *
 * Flow:
 *   stdin → parseEmail → convertToCAD → createExpense → Telegram success
 *
 * On any failure:
 *   → log to file → Telegram error alert → exit 1
 *
 * Config validation happens first so a misconfigured deployment fails loudly
 * before touching any external services.
 */

import { loadConfig } from './config.js';
import { parseEmail } from './emailParser.js';
import { convertToCAD } from './currencyConverter.js';
import { createExpense } from './spliit.js';
import { sendTelegram, formatSuccessMessage, formatErrorMessage } from './telegram.js';
import { log } from './logger.js';

// ---------------------------------------------------------------------------
// Validate config at startup — crashes with a clear message if .env is wrong
// ---------------------------------------------------------------------------
let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  process.stderr.write(`[config] ${err.message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Read the full raw email from stdin
// ---------------------------------------------------------------------------
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const rawEmail = await readStdin();

  try {
    // 1. Parse the MIME email into a structured transaction
    const tx = await parseEmail(rawEmail);

    // 2. Convert original currency → CAD
    const { cadAmount, rate } = await convertToCAD(tx.amount, tx.currency);

    // 3. Build a rich notes string for the Spliit expense
    const notes = [
      'Auto-imported from email',
      `Card ****${tx.cardLast4}`,
      tx.currency !== 'CAD'
        ? `${tx.currency} ${tx.amount.toFixed(2)} @ ${rate.toFixed(4)} → CAD ${cadAmount.toFixed(2)}`
        : `CAD ${cadAmount.toFixed(2)}`,
      tx.type,
    ].join(' | ');

    // 4. Create the Spliit expense
    await createExpense({
      groupId: cfg.spliit.groupId,
      paidById: cfg.spliit.paidById,
      participantIds: cfg.spliit.participantIds,
      title: tx.merchantRaw,
      cadAmount,
      expenseDate: tx.date,
      notes,
    });

    // 5. Write a success log entry
    await log(cfg.logFile, 'info', 'Expense created', {
      merchant: tx.merchantRaw,
      original: `${tx.currency} ${tx.amount}`,
      cad: cadAmount.toFixed(2),
      rate,
      card: tx.cardLast4,
      type: tx.type,
    });

    // 6. Telegram success notification
    await sendTelegram(
      cfg.telegram.botToken,
      cfg.telegram.chatId,
      formatSuccessMessage(tx, cadAmount, rate)
    );
  } catch (err) {
    // -----------------------------------------------------------------------
    // Error path: log locally, then attempt Telegram alert
    // -----------------------------------------------------------------------
    await log(cfg.logFile, 'error', err.message, { stack: err.stack });

    try {
      await sendTelegram(
        cfg.telegram.botToken,
        cfg.telegram.chatId,
        formatErrorMessage(err, rawEmail)
      );
    } catch (telegramErr) {
      // Telegram itself failed — write to stderr so cPanel's mail log picks it up
      process.stderr.write(
        `[telegram] Failed to send error alert: ${telegramErr.message}\n`
      );
    }

    process.exit(1);
  }
}

main();
