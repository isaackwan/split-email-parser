import { convertToCAD } from './currencyConverter.js';
import { createExpense } from './spliit.js';
import { sendTelegram, formatSuccessMessage } from './telegram.js';
import { log as fileLog } from './logger.js';

export function buildExpenseNotes(tx, cadAmount, rate, sourceLabel) {
  return [
    `Auto-imported from ${sourceLabel}`,
    `Channel ${tx.channel}`,
    tx.cardLast4 ? `Card ****${tx.cardLast4}` : null,
    tx.currency !== 'CAD'
      ? `${tx.currency} ${tx.amount.toFixed(2)} @ ${rate.toFixed(4)} -> CAD ${cadAmount.toFixed(2)}`
      : `CAD ${cadAmount.toFixed(2)}`,
    tx.type,
  ].filter(Boolean).join(' | ');
}

export function createConsoleLogger(consoleLike = console) {
  return async (_logFile, level, message, data = {}) => {
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      ...data,
    };
    const line = JSON.stringify(entry);
    if (level === 'error') {
      consoleLike.error(line);
    } else {
      consoleLike.log(line);
    }
  };
}

export async function processTransaction(
  tx,
  cfg,
  {
    sourceLabel = 'email',
    fetchFn = globalThis.fetch,
    logFn = fileLog,
  } = {}
) {
  const { cadAmount, rate } = await convertToCAD(tx.amount, tx.currency, fetchFn);
  const notes = buildExpenseNotes(tx, cadAmount, rate, sourceLabel);

  await createExpense({
    groupId: cfg.spliit.groupId,
    paidById: cfg.spliit.paidById,
    participantIds: cfg.spliit.participantIds,
    title: tx.merchantRaw,
    cadAmount,
    expenseDate: tx.date,
    notes,
  }, fetchFn);

  await logFn(cfg.logFile, 'info', 'Expense created', {
    merchant: tx.merchantRaw,
    original: `${tx.currency} ${tx.amount}`,
    cad: cadAmount.toFixed(2),
    rate,
    channel: tx.channel,
    card: tx.cardLast4,
    type: tx.type,
    source: sourceLabel,
  });

  await sendTelegram(
    cfg.telegram.botToken,
    cfg.telegram.chatId,
    formatSuccessMessage(tx, cadAmount, rate),
    fetchFn
  );

  return { cadAmount, rate };
}
