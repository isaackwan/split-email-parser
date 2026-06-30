/**
 * Entry point — invoked by wrapper.sh when cPanel pipes an email to this script.
 *
 * Flow:
 *   stdin → parseEmail → processTransaction → Telegram success
 *
 * On parse failure:
 *   → log to file → Telegram error alert → exit 0 (avoid MTA bounce noise)
 *
 * On downstream failure:
 *   → log to file → Telegram error alert → exit 1
 *
 * Config validation happens first so a misconfigured deployment fails loudly
 * before touching any external services.
 */

import { loadConfig } from './config.js';
import { handlePipedEmail } from './pipeHandler.js';

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
  process.exitCode = await handlePipedEmail(rawEmail, cfg);
}

main();
