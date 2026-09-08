#!/usr/bin/env bash
#
# Starts the Foshol Doctor frontend on http://localhost:4200 with every required
# dependency in place. Assumes the backend (foshol-doctor) is already running at
# http://localhost:8080 — this script never starts, stops or touches it.
#
# What it does, in order:
#   1. Verifies Node/npm are present and match what this project was built against.
#   2. `npm install` if node_modules is missing or package.json/lock changed since
#      the last install (skip with --skip-install if you know it's current).
#   3. Regenerates the API client from the frozen OpenAPI contract, ONLY if it is
#      missing (src/app/generated/ is a committed, hand-verified artefact — see
#      COMMON-NFR-043 / DEVIATIONS.md; this script never overwrites it silently).
#   4. Merges the i18n fragments in src/i18n/*.i18n.json into public/i18n/{bn,en}.json
#      (WEB-UX-010/017) — cheap and idempotent, always run.
#   5. Checks the backend is reachable at :8080 and warns (not fails) if it is not,
#      since the app is genuinely usable to inspect even with the backend down.
#   6. Starts `ng serve` on :4200 — the origin the backend's CORS allow-list expects.
#      No dev proxy, deliberately (see README.md).
#
# Usage:
#   ./start-ui.sh                 # normal start
#   ./start-ui.sh --skip-install  # skip the npm install check (faster on repeat runs)
#   PORT=4300 ./start-ui.sh       # serve on a different port
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-4200}"
API_ORIGIN="${API_ORIGIN:-http://localhost:8080}"
SKIP_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=1 ;;
    *) echo "start-ui.sh: unrecognised argument '$arg'" >&2; exit 1 ;;
  esac
done

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; BLUE=$'\033[0;34m'; RESET=$'\033[0m'
step() { echo "${BLUE}▸${RESET} $*"; }
ok()   { echo "${GREEN}✔${RESET} $*"; }
warn() { echo "${YELLOW}⚠${RESET} $*"; }
fail() { echo "${RED}✘${RESET} $*" >&2; exit 1; }

echo "Foshol Doctor — frontend startup"
echo "================================="

# ── 1. Toolchain ─────────────────────────────────────────────────────────────
step "Checking Node and npm"
command -v node >/dev/null 2>&1 || fail "node not found on PATH. Install Node (this project was built against v25.9.0) and retry."
command -v npm  >/dev/null 2>&1 || fail "npm not found on PATH."

NODE_VERSION="$(node -v)"
NPM_VERSION="$(npm -v)"
ok "node ${NODE_VERSION}, npm ${NPM_VERSION}"

REQUIRED_NODE_MAJOR=20
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  fail "Node ${NODE_VERSION} is too old. Angular 22 needs Node ${REQUIRED_NODE_MAJOR}+."
fi

# ── 2. Dependencies ──────────────────────────────────────────────────────────
if [ "$SKIP_INSTALL" -eq 1 ]; then
  warn "Skipping dependency install (--skip-install passed)"
elif [ ! -d node_modules ]; then
  step "node_modules missing — running npm install"
  npm install
  ok "Dependencies installed"
elif [ package.json -nt node_modules ] || [ package-lock.json -nt node_modules ]; then
  step "package.json/package-lock.json changed since last install — running npm install"
  npm install
  ok "Dependencies updated"
else
  ok "Dependencies already installed and current"
fi

# Fail fast and clearly if every dependency is not pinned exactly (WEB-NFR-005).
step "Checking dependency pins"
node scripts/check-pins.mjs || fail "One or more dependencies are not pinned to an exact version. See output above."
ok "All dependencies pinned exactly"

# ── 3. Generated API client ──────────────────────────────────────────────────
# src/app/generated/ is committed and hand-verified; this script only generates it
# when it is entirely absent (a fresh clone missing the directory for some reason).
# It never regenerates over an existing, possibly hand-adjusted, checked-in client —
# use `npm run api:gen` yourself if you deliberately want a fresh pull from the spec.
if [ ! -d src/app/generated ] || [ -z "$(ls -A src/app/generated 2>/dev/null)" ]; then
  step "src/app/generated/ is missing — generating the API client from the frozen contract"
  npm run api:gen
  ok "API client generated"
else
  ok "Generated API client present (src/app/generated/)"
fi

# ── 4. i18n catalogues ────────────────────────────────────────────────────────
step "Merging i18n fragments into public/i18n/{bn,en}.json"
npm run i18n:build
ok "i18n catalogues up to date"

# ── 5. Backend reachability (advisory only — never blocks the UI) ───────────
step "Checking backend at ${API_ORIGIN}"
if node -e "
  fetch('${API_ORIGIN}/actuator/health', { signal: AbortSignal.timeout(3000) })
    .then(r => r.ok ? process.exit(0) : process.exit(1))
    .catch(() => process.exit(1))
" 2>/dev/null; then
  ok "Backend is reachable at ${API_ORIGIN}"
else
  warn "Backend not reachable at ${API_ORIGIN}."
  warn "The UI will still start, but login and every API call will fail until it is up."
  warn "Start it from the foshol-doctor repo: ./tools/start-stack.sh"
fi

# ── 6. Serve ──────────────────────────────────────────────────────────────────
echo
echo "================================="
ok "Starting the dev server on http://localhost:${PORT}"
echo "  (Ctrl-C to stop. No dev proxy — the app talks to ${API_ORIGIN} directly.)"
echo

exec npx ng serve --port "${PORT}"
