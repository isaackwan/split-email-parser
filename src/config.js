import dotenv from 'dotenv';

/**
 * All required environment variables with human-readable descriptions.
 * Adding a new required var here automatically includes it in validation
 * and in the error message shown to the operator.
 */
export const REQUIRED_VARS = {
  SPLIIT_GROUP_ID:
    'Spliit group ID — the path segment in the group URL (e.g. iFGaF-1v8LxH2Vvp-DWpi)',
  SPLIIT_PAID_BY_ID:
    'Participant ID of the person who paid (your Spliit participant ID)',
  SPLIIT_PARTICIPANT_IDS:
    'Comma-separated list of ALL participant IDs to split with (including yours)',
  TELEGRAM_BOT_TOKEN:
    'Telegram bot token obtained from @BotFather',
  TELEGRAM_CHAT_ID:
    'Telegram chat/user ID that will receive notifications',
  LOG_FILE:
    'Absolute path to the fallback NDJSON log file (will be created if missing)',
};

/**
 * Loads and validates environment variables.
 * Call once at startup in index.js — not imported by any other module,
 * so unit tests can import individual modules without triggering this.
 *
 * @throws {Error} if any required variable is absent
 * @returns {AppConfig}
 *
 * @typedef {{ spliit: SpliitConfig, telegram: TelegramConfig, logFile: string }} AppConfig
 * @typedef {{ groupId: string, paidById: string, participantIds: string[] }} SpliitConfig
 * @typedef {{ botToken: string, chatId: string }} TelegramConfig
 */
export function loadConfig() {
  dotenv.config(); // loads .env into process.env; no-op if file is absent

  const missing = Object.entries(REQUIRED_VARS).filter(
    ([key]) => !process.env[key]?.trim()
  );

  if (missing.length > 0) {
    const lines = missing
      .map(([key, desc]) => `  ${key}\n    # ${desc}`)
      .join('\n');
    throw new Error(
      `Missing required environment variables:\n${lines}\n\nSee .env.example for reference.`
    );
  }

  return {
    spliit: {
      groupId: process.env.SPLIIT_GROUP_ID.trim(),
      paidById: process.env.SPLIIT_PAID_BY_ID.trim(),
      participantIds: process.env.SPLIIT_PARTICIPANT_IDS
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN.trim(),
      chatId: process.env.TELEGRAM_CHAT_ID.trim(),
    },
    logFile: process.env.LOG_FILE.trim(),
  };
}
