# icbc-email-parser

Parses ICBC Asia credit card notification emails piped from cPanel, converts the
transaction amount to CAD, creates an expense in [Spliit](https://spliit.app), and
sends a Telegram notification.

```
ICBC email → cPanel pipe → wrapper.sh → node src/index.js
                                              ├── emailParser   (MIME + regex)
                                              ├── currencyConverter (frankfurter.app)
                                              ├── spliit        (tRPC API)
                                              └── telegram      (Bot API)
```

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 20 |
| cPanel shared hosting | with email piping enabled |
| Spliit group | group ID + participant IDs |
| Telegram bot | token + chat ID |

---

## Installation

```bash
# 1. Clone to your home directory on the server (via SSH or Git in cPanel)
git clone https://github.com/you/icbc-email-parser.git ~/icbc-email-parser
cd ~/icbc-email-parser

# 2. Install dependencies
npm ci --omit=dev

# 3. Configure
cp .env.example .env
nano .env          # fill in all six values — the parser refuses to start without them

# 4. Make the pipe script executable
chmod +x wrapper.sh

# 5. Create the log file location
mkdir -p ~/logs
touch ~/logs/icbc-parser.log
```

---

## Configuration (`.env`)

| Variable | Description |
|---|---|
| `SPLIIT_GROUP_ID` | Path segment from the Spliit group URL, e.g. `iFGaF-1v8LxH2Vvp-DWpi` |
| `SPLIIT_PAID_BY_ID` | Your Spliit participant ID (the payer) |
| `SPLIIT_PARTICIPANT_IDS` | Comma-separated list of **all** participant IDs (including yours) |
| `TELEGRAM_BOT_TOKEN` | Token from [@BotFather](https://t.me/botfather) |
| `TELEGRAM_CHAT_ID` | Your user/chat ID — get it from [@userinfobot](https://t.me/userinfobot) |
| `LOG_FILE` | Absolute path for the NDJSON fallback log, e.g. `/home/user/logs/icbc-parser.log` |

### Finding your Spliit participant IDs

1. Open your Spliit group in a browser
2. Open DevTools → Network tab
3. Add any expense and submit it
4. Find the `groups.expenses.create` request
5. Look at the `paidBy` and `paidFor[].participant` fields in the request body

---

## cPanel email pipe setup

1. Log in to cPanel → **Email Accounts**
2. Select the address that receives ICBC notifications → **Manage**
3. Go to **Email Filters** → **Add Filter**
4. Set the rule so it matches the ICBC sender (e.g. `From` contains `icbcasia.com`)
5. Set the action to **Pipe to a Program**
6. Enter the absolute path: `/home/yourusername/icbc-email-parser/wrapper.sh`

> **Node.js location**: `wrapper.sh` auto-detects node at common cPanel paths.
> If it fails, edit the `NODE_BIN` loop at the top of `wrapper.sh` and add your
> server's actual path (find it with `which node` in SSH).

---

## Running locally / testing the pipe

```bash
# Smoke-test with a real fixture email
cat test/fixtures/sample-purchase.txt | node src/index.js
```

---

## Development

```bash
# Run all tests (Node.js)
node --test

# Run all tests (Bun)
bun test

# Watch mode (Node.js 22+)
node --test --watch
```

---

## Extending

### Add a new transaction type

In `src/emailParser.js`, add an entry to `TRANSACTION_TYPES`:

```js
export const TRANSACTION_TYPES = {
  PURCHASE: '成功消費',
  PRE_AUTH: '成功預授權支出',
  REFUND:   '成功退款',      // ← add here
};
```

The regex rebuilds itself automatically.

### Add a new currency

In `src/emailParser.js`, add an entry to `CURRENCY_NAMES`:

```js
export const CURRENCY_NAMES = {
  // ...existing entries...
  '瑞士法郎': 'CHF',   // ← add here
};
```

Currencies longer than 2 characters will naturally sort correctly (longest-first
matching is enforced by the regex builder). The currency converter uses
[frankfurter.app](https://frankfurter.app) which supports all major ISO 4217 codes.

---

## Log format

Each entry is one line of NDJSON:

```json
{"ts":"2026-06-01T08:19:00.000Z","level":"info","message":"Expense created","merchant":"HONG KONG TRAMWAY95800","original":"HKD 2.3","cad":"0.40","rate":0.1756,"card":"3498","type":"成功消費"}
{"ts":"2026-06-01T08:20:00.000Z","level":"error","message":"Spliit API error: HTTP 500 ...","stack":"..."}
```
