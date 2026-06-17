#!/usr/bin/env bash
# Idempotent installer for the `pm` CLI on a fresh machine / session.
#   npm run setup
#
# Makes `pm` runnable from ANY directory by:
#   1. installing project deps (so `tsx` and the app exist)
#   2. ensuring a global `tsx` interpreter is on PATH (the shebang needs it)
#   3. `npm link` (registers `pm` in the active npm global bin)
#   4. symlinking the global `pm` into ~/.local/bin as a fallback PATH location
#
# Safe to re-run. Prints what it did and verifies at the end.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }

# 1. Project dependencies (idempotent; npm skips what's present).
say "Installing project dependencies (npm install)"
npm install

# 2. Global tsx — the pm shebang is `#!/usr/bin/env -S tsx`, which resolves tsx
#    as a PATH executable. Without a GLOBAL tsx, pm only works inside the repo
#    (the project's local node_modules/.bin/tsx is only on PATH under `npm run`,
#    not in a plain shell). Check the global bin specifically — `command -v tsx`
#    would falsely match the local copy while this script runs under npm.
GLOBAL_TSX="$(npm prefix -g)/bin/tsx"
if [ -x "$GLOBAL_TSX" ] || [ -L "$GLOBAL_TSX" ]; then
  say "Global tsx present ($GLOBAL_TSX) — skipping install"
else
  say "Installing tsx globally (npm install -g tsx)"
  npm install -g tsx
fi

# 3. npm link — exposes `pm` in the active npm global bin.
say "Linking pm into the npm global bin (npm link)"
npm link

# Resolve the global bin dir and the linked pm path.
GLOBAL_BIN="$(npm prefix -g)/bin"
GLOBAL_PM="$GLOBAL_BIN/pm"

# 4. Fallback symlink into ~/.local/bin (covers shells where the npm global
#    bin isn't on PATH).
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"
if [ -e "$GLOBAL_PM" ]; then
  ln -sf "$GLOBAL_PM" "$LOCAL_BIN/pm"
  say "Symlinked $LOCAL_BIN/pm -> $GLOBAL_PM"
else
  warn "Expected linked pm at $GLOBAL_PM but it's missing; skipping ~/.local/bin symlink"
fi

# Verify.
echo
if command -v pm >/dev/null 2>&1; then
  say "Success: pm resolves to $(command -v pm)"
else
  warn "pm not found on PATH. Add one of these to your shell profile, then re-open the shell:"
  warn "  export PATH=\"$GLOBAL_BIN:\$PATH\"      # npm global bin"
  warn "  export PATH=\"$LOCAL_BIN:\$PATH\"       # ~/.local/bin fallback"
fi

cat <<'EOF'

Next: start the server, then call pm from anywhere.
  npm run dev                       # starts http://localhost:3000
  pm project list                   # in another shell
  PM_API=http://localhost:3001 pm project list   # if on a non-default port
EOF
