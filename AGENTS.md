# AGENT.md

Guidance for AI coding agents working on this repository.

---

## What this project does

This project imports transaction notifications into Spliit. It has two
entrypoints:

- `src/pipe.js`: a short-lived Node.js process invoked by cPanel's email pipe.
  It reads a raw MIME email from stdin and exits after handling it.
- `src/web.js`: a long-lived Hono Node server that accepts Google Wallet
  notification JSON over `POST /`.

Both entrypoints extract a `Transaction`, pass it through shared core logic,
convert the amount to CAD, create an expense in Spliit, and send a Telegram
notification. On failures they log locally and send a Telegram error alert.

```
stdin (raw MIME email)
  └─ parseEmail()          src/emailParser.js
       └─ processTransaction() src/transactionProcessor.js
            └─ convertToCAD()   src/currencyConverter.js  →  frankfurter.app
                 └─ createExpense()  src/spliit.js         →  spliit.app tRPC API
                      └─ sendTelegram()  src/telegram.js   →  api.telegram.org

POST / (Google Wallet notification JSON)
  └─ parseGoogleWalletNotification() src/googleWalletParser.js
       └─ processTransaction()       src/transactionProcessor.js
```

---

## Repository layout

```
src/
  pipe.js              Orchestration only — reads stdin, calls the others in order
  web.js               Hono Node server entrypoint for Google Wallet POSTs
  webApp.js            Hono app factory; accepts injected config/fetch/logger
  transactionProcessor.js Shared convert/create/log/Telegram success flow
  config.js            Env var loading and validation; import only from entrypoints
  emailParser.js       MIME parsing + regex extraction; all Chinese-text logic lives here
  googleWalletParser.js Google Wallet notification parser + currency-symbol registry
  currencyConverter.js Single function: convertToCAD(amount, currency, fetchFn?)
  spliit.js            Single function: createExpense(params, fetchFn?)
  telegram.js          sendTelegram() + pure formatter functions (no I/O)
  logger.js            NDJSON append-to-file; swallows its own errors by design

test/
  emailParser.test.js       Unit (inline strings) + integration (MIME fixtures)
  googleWalletParser.test.js Google Wallet notification parser tests
  webApp.test.js            Hono route behavior with injected dependencies
  currencyConverter.test.js  7 tests
  spliit.test.js            11 tests
  telegram.test.js          21 tests
  fixtures/
    icbca-purchase.eml      Real ICBCA "成功消費" email (quoted-printable HTML, UTF-8)
    icbca-preauth.eml       Real ICBCA "成功預授權支出" email

wrapper.sh             Shell entry point for cPanel pipe; locates node and execs pipe.js
.env.example           All required keys with comments; checked in, .env is git-ignored
.github/workflows/ci.yml  Matrix: Node 20/22/24 + Bun latest + Deno latest
```

---

## Running tests

```bash
deno test --allow-read --no-check   # Local Linux default
node --test                         # Production/server runtime, Node.js ≥ 20
bun test                            # Local Windows default
```

Try all available runtimes before committing. Local Linux usually has Deno,
production/cPanel runs Node.js, and local Windows usually has Bun; CI exercises
Node 20/22/24, Bun latest, and Deno latest. All tests must pass before
committing. There are no test helpers or shared fixtures beyond the email
files in `test/fixtures/`. Do not add a test framework — the project uses
`node:test` + `node:assert/strict`, which Deno and Bun also run.

---

## Core design decisions to preserve

### 1. Dependency injection via `fetchFn`

Every function that makes a network call accepts an optional `fetchFn` parameter
that defaults to `globalThis.fetch`. Tests pass a mock; production uses the
platform default. Never use `fetch` directly inside a function body.

```js
// correct
export async function createExpense(params, fetchFn = globalThis.fetch) { … }

// wrong — untestable without monkey-patching
export async function createExpense(params) {
  const res = await fetch(…);
}
```

### 2. Registries drive regexes — don't hardcode patterns

`TRANSACTION_TYPES` and `CURRENCY_NAMES` in `emailParser.js` are the single
source of truth. The regex is built from them at module load time. Adding a new
transaction type or currency means adding one line to the relevant object —
nothing else changes.

The regex alternation sorts entries longest-first so a shorter Chinese term
(e.g. `加元`) never shadow a longer one (`加拿大元`) in the alternation.

### 3. Merchant names are passed through raw

`merchantRaw` is stored exactly as the bank sends it, including internal
whitespace padding. The only normalisation applied is a single `.trim()` call to
remove leading/trailing whitespace. Do not collapse internal spaces or strip
country codes — that's a future caller concern. If merchant normalisation is
added later, it belongs in a dedicated `normaliseMerchant(raw)` function in
`emailParser.js`, called from `pipe.js` before `createExpense`.

### 4. Transaction types are treated uniformly

`PURCHASE` and `PRE_AUTH` go through identical processing. The `type` field is
preserved on the `Transaction` object and written to both the Spliit notes and
the log, so a future caller can branch on it. Do not add `if (type === PRE_AUTH)
skip` logic without a product decision.

### 5. Shared transaction processing belongs in `transactionProcessor.js`

`pipe.js` and `webApp.js` both create the same kind of `Transaction` object and
then call `processTransaction()`. Keep conversion, Spliit expense creation,
success logging, and Telegram success notifications in that shared module so
new input channels do not duplicate downstream behavior.

### 6. Config is validated once at process startup

`loadConfig()` is called at the top level of `pipe.js` and `web.js` before the
entrypoint starts handling input. It hard crashes with a human-readable message
listing every missing variable. Shared modules should accept config as an
argument instead of importing `config.js`; this keeps unit tests free of dotenv
side effects and leaves `webApp.js` portable to Cloudflare Workers via `c.env`.

### 7. The logger never throws

`logger.js` wraps `appendFile` in try/catch and falls back to stderr. It is used
inside both the success path and the error-handling path; if it threw, it could
suppress the original error.

For future serverless Worker entrypoints, inject a console-style structured
logger when `LOG_FILE` is unavailable. Do not make Worker-compatible code depend
on filesystem writes.

### 8. Spliit amount is integer cents

Spliit stores amounts as integers (×100). `Math.round(cadAmount * 100)` is the
conversion. Do not pass floats. A 0.03 HKD transaction at a low FX rate will
round to 1 cent minimum — that is correct behaviour.

### 9. Dates are always HKT-aware

ICBCA emails contain local Hong Kong time with no timezone suffix. The parser
appends `+08:00` before constructing a `Date` object. All downstream code uses
the resulting UTC-correct `Date` — never re-parse the string.

Google Wallet notifications send `postedAt` as epoch milliseconds. Use that
timestamp directly to construct the `Date`.

### 10. Google Wallet notifications are web-only

Google Wallet parsing lives in `src/googleWalletParser.js`, not
`emailParser.js`. `GOOGLE_WALLET_CURRENCY_SYMBOLS` is the source of truth for
symbol-to-ISO parsing. Plain `$` is intentionally rejected as ambiguous; add an
explicit symbol if Google Wallet emits a new unambiguous currency form.

Receipt-preparation notifications such as "Preparing your receipt" /
"We're adding the location to your receipt" are ignored with HTTP 204. They must
not create a Spliit expense or send a Telegram error alert.

---

## Adding a new currency

Edit `CURRENCY_NAMES` in `src/emailParser.js`:

```js
export const CURRENCY_NAMES = {
  // existing entries …
  '瑞士法郎': 'CHF',   // ← new line
};
```

Add a corresponding unit test in `test/emailParser.test.js` under the
`CURRENCY_NAMES registry` describe block, and an inline `parseTransactionText`
test if you have a sample string to hand.

Frankfurter.app supports all major ISO 4217 codes, so no change to
`currencyConverter.js` is needed.

For Google Wallet notification symbols, edit `GOOGLE_WALLET_CURRENCY_SYMBOLS`
in `src/googleWalletParser.js` and add tests in
`test/googleWalletParser.test.js`. Do not guess plain `$`; keep it rejected
unless there is a product decision to choose a default.

---

## Adding a new transaction type

Edit `TRANSACTION_TYPES` in `src/emailParser.js`:

```js
export const TRANSACTION_TYPES = {
  PURCHASE: '成功消費',
  PRE_AUTH: '成功預授權支出',
  REFUND:   '成功退款',   // ← new line
};
```

Add a fixture email if you have one, or an inline `parseTransactionText` test
with a synthetic string. No other file needs changing unless the new type
requires different downstream behaviour (see decision #4 above).

---

## What not to change without discussion

| Thing | Reason |
|---|---|
| `node:test` / `node:assert` | Keeps zero prod dependencies in test code; works identically in Bun |
| `"type": "module"` in package.json | ESM throughout; mixing CJS would require `.cjs` extensions and re-export shims |
| The `fetchFn` signature on every networked function | Tests depend on it; changing to global fetch breaks all network mocks |
| `wrapper.sh` using `exec` | Replaces the shell process so stdin flows through unmodified |
| `.env` in `.gitignore` | Contains live credentials; must never be committed |
| Hono web app dependency injection | Keeps route tests pure and leaves a path to Cloudflare Workers |

---

## Environment variables

All six are required. The process exits 1 with a clear list of what is missing
if any are absent or blank. See `.env.example` for descriptions.

```
SPLIIT_GROUP_ID
SPLIIT_PAID_BY_ID
SPLIIT_PARTICIPANT_IDS   (comma-separated, includes the payer)
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
LOG_FILE                 (absolute path, created on first write)
```

`src/web.js` also accepts optional `PORT`; it defaults to `3000`.

---

## External APIs

| Service | Auth | Notes |
|---|---|---|
| `frankfurter.app/latest` | None | Free; returns `{ rates: { CAD: number } }` |
| `spliit.app/api/trpc/groups.expenses.create?batch=1` | None (group is public) | tRPC batch; superjson meta required for `expenseDate` and 
`conversionRate` |
| `api.telegram.org/bot{token}/sendMessage` | Bot token in URL | HTML parse mode; escape `& < >` before inserting user data |

---

## Deployment context

- **Email runtime**: cPanel shared hosting, invoked via email pipe — not a daemon
- **Web runtime**: Hono on Node via `@hono/node-server`; `webApp.js` should stay
  compatible with a future Cloudflare Worker wrapper that exports `app.fetch`
- **Email startup time matters**: the process handles one email and exits; avoid lazy
  imports or deferred initialisations on that path
- **No writable `/tmp` guaranteed**: use `LOG_FILE` (configured to a path inside
  `$HOME`) for any disk writes
- **PATH is minimal**: `wrapper.sh` enumerates known node locations; do not
  assume `node` is on `PATH` inside the pipe environment
