import { appendFile } from 'node:fs/promises';

/**
 * Appends a newline-delimited JSON (NDJSON) log entry to the configured log file.
 *
 * Failures here are written to stderr and swallowed — the logger must never
 * cause the process to crash, since it is also used inside error-handling paths.
 *
 * @param {string}  logFile         - Absolute path to the log file
 * @param {'info' | 'error'} level
 * @param {string}  message
 * @param {object}  [data]          - Additional fields to include in the entry
 */
export async function log(logFile, level, message, data = {}) {
  const entry =
    JSON.stringify({ ts: new Date().toISOString(), level, message, ...data }) + '\n';

  try {
    await appendFile(logFile, entry, 'utf8');
  } catch (err) {
    // Writing to stderr is always a safe last resort
    process.stderr.write(`[logger] Could not write to "${logFile}": ${err.message}\n`);
    process.stderr.write(entry);
  }
}
