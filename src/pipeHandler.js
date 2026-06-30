import { EmailParseError, parseEmail } from './emailParser.js';
import { log as fileLog } from './logger.js';
import { sendTelegram, formatErrorMessage } from './telegram.js';
import { processTransaction } from './transactionProcessor.js';

export async function handlePipedEmail(
  rawEmail,
  cfg,
  {
    parseFn = parseEmail,
    processor = processTransaction,
    fetchFn = globalThis.fetch,
    logFn = fileLog,
    stderr = process.stderr,
  } = {}
) {
  try {
    const tx = await parseFn(rawEmail);
    await processor(tx, cfg, {
      sourceLabel: 'email',
      fetchFn,
      logFn,
    });
    return 0;
  } catch (err) {
    await logFn(cfg.logFile, 'error', err.message, { stack: err.stack });

    try {
      await sendTelegram(
        cfg.telegram.botToken,
        cfg.telegram.chatId,
        formatErrorMessage(err, rawEmail),
        fetchFn
      );
    } catch (telegramErr) {
      stderr.write(
        `[telegram] Failed to send error alert: ${telegramErr.message}\n`
      );
    }

    return err instanceof EmailParseError ? 0 : 1;
  }
}
