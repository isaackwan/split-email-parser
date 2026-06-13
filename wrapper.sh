#!/bin/bash
# =============================================================================
# wrapper.sh — cPanel email pipe entry point
#
# In cPanel: Email Accounts → Manage → Email Filters → Add Filter
#   Rule:   "To" matches  cards@yourdomain.com  (or use a forwarder)
#   Action: Pipe to program →  /home/yourusername/icbc-email-parser/wrapper.sh
#
# Make executable after deployment:
#   chmod +x /home/yourusername/icbc-email-parser/wrapper.sh
# =============================================================================

# ---------------------------------------------------------------------------
# 1. Locate the node binary.
#    cPanel's piped-mail environment has a minimal PATH; enumerate common
#    locations and fall back to whatever is in PATH as a last resort.
# ---------------------------------------------------------------------------
NODE_BIN=""
for candidate in \
  /usr/local/bin/node \
  /usr/bin/node \
  "$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node/" 2>/dev/null | sort -V | tail -1)/bin/node" \
  "$(command -v node 2>/dev/null)"; do
  if [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [ -z "$NODE_BIN" ]; then
  echo "[wrapper.sh] ERROR: node binary not found. Install Node.js >= 20 on this server." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Change to the project root so dotenv resolves .env correctly.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || { echo "[wrapper.sh] ERROR: cannot cd to $SCRIPT_DIR" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 3. Hand stdin straight to the parser.
#    'exec' replaces this shell process — stdin flows through unmodified.
# ---------------------------------------------------------------------------
exec "$NODE_BIN" src/index.js
