# AGENT.md

Guidance for AI coding agents working on this repository.

---

## What this project does

A short-lived Node.js process (not a server) is invoked by cPanel's email pipe
whenever ICBC Asia sends a credit card notification email. It reads the raw email
from stdin, extracts the transaction, converts the amount to CAD, creates an
expense in Spliit, and sends a Telegram notification. On any failure it logs
locally and sends a Telegram error alert before exiting 1.

```
stdin (raw MIME email)
  └─ parseEmail()          src/emailParser.js
       └─ convertToCAD()   src/currencyConverter.js  →  frankfurter.app
            └─ createExpense()  src/spliit.js         →  spliit.app tRPC API
                 └─ sendTelegram()  src/telegram.js   →  api.telegram.org
```

---

## Repository layout

```
src/
  index.js             Orchestration only — reads stdin, calls the others in order
  config.js            Env var loading and validation; import here only from index.js
  emailParser.js       MIME parsing + regex extraction; all Chinese-text logic lives here
  currencyConverter.js Single function: convertToCAD(amount, currency, fetchFn?)
  spliit.js            Single function: createExpense(params, fetchFn?)
  telegram.js          sendTelegram() + pure formatter functions (no I/O)
  logger.js            NDJSON append-to-file; swallows its own errors by design

test/
  emailParser.test.js       22 tests — unit (inline strings) + integration (MIME fixtures)
  currencyConverter.test.js  7 tests
  spliit.test.js            11 tests
  telegram.test.js          21 tests
  fixtures/
    sample-purchase.txt     Real ICBC "成功消費" email (quoted-printable HTML, UTF-8)
    sample-preauth.txt      Real ICBC "成功預授權支出" email

wrapper.sh             Shell entry point for cPanel pipe; locates node and execs index.js
.env.example           All required keys with comments; checked in, .env is git-ignored
.github/workflows/ci.yml  Matrix: Node 20/22/24 + Bun latest + Deno latest
```

---

## Running tests

```bash
node --test          # Node.js (≥ 20)
bun test             # Bun
```

All 61 tests must pass before committing. There are no test helpers or shared
fixtures beyond the two email files in `test/fixtures/`. Do not add a test
framework — the project uses Node's built-in `node:test` + `node:assert/strict`.

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
`emailParser.js`, called from `index.js` before `createExpense`.

### 4. Transaction types are treated uniformly

`PURCHASE` and `PRE_AUTH` go through identical processing. The `type` field is
preserved on the `Transaction` object and written to both the Spliit notes and
the log, so a future caller can branch on it. Do not add `if (type === PRE_AUTH)
skip` logic without a product decision.

### 5. Config is validated once at process startup

`loadConfig()` is called at the top level of `index.js` before `main()`. It hard
crashes with a human-readable message listing every missing variable. No other
module imports `config.js` — this keeps unit tests free of dotenv side effects.

### 6. The logger never throws

`logger.js` wraps `appendFile` in try/catch and falls back to stderr. It is used
inside both the success path and the error-handling path; if it threw, it could
suppress the original error.

### 7. Spliit amount is integer cents

Spliit stores amounts as integers (×100). `Math.round(cadAmount * 100)` is the
conversion. Do not pass floats. A 0.03 HKD transaction at a low FX rate will
round to 1 cent minimum — that is correct behaviour.

### 8. Dates are always HKT-aware

ICBC emails contain local Hong Kong time with no timezone suffix. The parser
appends `+08:00` before constructing a `Date` object. All downstream code uses
the resulting UTC-correct `Date` — never re-parse the string.

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

- **Runtime**: cPanel shared hosting, invoked via email pipe — not a daemon
- **Startup time matters**: the process handles one email and exits; avoid lazy
  imports or deferred initialisations
- **No writable `/tmp` guaranteed**: use `LOG_FILE` (configured to a path inside
  `$HOME`) for any disk writes
- **PATH is minimal**: `wrapper.sh` enumerates known node locations; do not
  assume `node` is on `PATH` inside the pipe environment
