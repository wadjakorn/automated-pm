#!/usr/bin/env bash
# cc-bridge installer — macOS + Linux. One command sets up the dev-machine side:
# copies the listener+runner, builds the project->repo map, installs a keepalive
# service (launchd on macOS, systemd --user on Linux), and health-checks it.
#
#   bash cc-bridge/install.sh            # interactive
#   CC_BRIDGE_SECRET=… CC_BRIDGE_BIND=… bash cc-bridge/install.sh   # unattended
#
# Re-runnable: reloads the service and rewrites config on each run.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # the repo's cc-bridge/ dir
HOME_DIR="${CC_BRIDGE_HOME:-$HOME/.cc-bridge}"
PORT="${CC_BRIDGE_PORT:-8787}"
OS="$(uname -s)"

say()  { printf '\033[1;36m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
ask()  { # ask <var> <prompt> <default>
  local __v=$1 __p=$2 __d=${3:-} __in=""
  if [ -n "${!__v:-}" ]; then return; fi          # already set via env -> keep
  if [ -t 0 ]; then read -r -p "$__p${__d:+ [$__d]}: " __in || true; fi
  printf -v "$__v" '%s' "${__in:-$__d}"
}

# ---- 0. prerequisites -----------------------------------------------------
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }
command -v curl    >/dev/null || { echo "curl is required"; exit 1; }
command -v claude  >/dev/null || warn "claude CLI not found on PATH — install it and run 'claude setup-token' before going live."
command -v pm      >/dev/null || warn "pm CLI not found on PATH — the runner needs it to drive the board."
command -v gh      >/dev/null || warn "gh CLI not found — the runner opens PRs with it; run 'gh auth login'."

# ---- 1. bind address (Tailscale IP, or loopback for same-device) ----------
detect_ip() {
  local ip=""
  if command -v tailscale >/dev/null; then ip="$(tailscale ip -4 2>/dev/null | head -1)"; fi
  if [ -z "$ip" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
    ip="$(/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 2>/dev/null | head -1)"
  fi
  printf '%s' "$ip"
}
DEFAULT_BIND="$(detect_ip)"; DEFAULT_BIND="${DEFAULT_BIND:-127.0.0.1}"
ask CC_BRIDGE_BIND "Bind address (Tailscale IP for cross-device, 127.0.0.1 for same-device)" "$DEFAULT_BIND"
case "$CC_BRIDGE_BIND" in 0.0.0.0|::) echo "refusing $CC_BRIDGE_BIND (all-interfaces). Use a Tailscale IP or 127.0.0.1."; exit 1;; esac

# ---- 2. shared secret -----------------------------------------------------
if [ -z "${CC_BRIDGE_SECRET:-}" ]; then
  GEN="$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')"
  ask CC_BRIDGE_SECRET "Shared secret (blank = generate)" "$GEN"
fi

# ---- 3. project -> repo map ----------------------------------------------
mkdir -p "$HOME_DIR/logs"
CONFIG="$HOME_DIR/config.json"
if [ -t 0 ] && [ -z "${CC_BRIDGE_KEEP_CONFIG:-}" ]; then
  say "Map each PM project to a local repo (project id from the board URL ?project=<id>). Blank id to finish."
  python3 - "$CONFIG" <<'PY'
import json, sys
projects = {}
while True:
    pid = input("  project id: ").strip()
    if not pid: break
    path = input(f"  repo path for {pid}: ").strip()
    if path: projects[pid] = path
json.dump({"projects": projects}, open(sys.argv[1], "w"), indent=2)
print(f"  wrote {len(projects)} project(s)")
PY
elif [ ! -f "$CONFIG" ]; then
  cp "$SRC/config.example.json" "$CONFIG"
  warn "wrote a template config — edit $CONFIG to map projects -> repos."
fi

# ---- 4. copy listener + runner -------------------------------------------
cp "$SRC/listener.py" "$SRC/run.py" "$HOME_DIR/"
chmod +x "$HOME_DIR/run.py" "$HOME_DIR/listener.py"

# ---- 5. install keepalive service ----------------------------------------
install_launchd() {
  local plist="$HOME/Library/LaunchAgents/com.you.ccbridge.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>com.you.ccbridge</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/python3</string><string>$HOME_DIR/listener.py</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>CC_BRIDGE_BIND</key><string>$CC_BRIDGE_BIND</string>
    <key>CC_BRIDGE_PORT</key><string>$PORT</string>
    <key>CC_BRIDGE_SECRET</key><string>$CC_BRIDGE_SECRET</string>
    <key>CC_BRIDGE_HOME</key><string>$HOME_DIR</string>
  </dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME_DIR/logs/listener.out.log</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/logs/listener.err.log</string>
</dict></plist>
EOF
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load -w "$plist"
  say "launchd agent loaded: $plist"
}

install_systemd() {
  local unit="$HOME/.config/systemd/user/cc-bridge.service"
  mkdir -p "$HOME/.config/systemd/user"
  cat >"$unit" <<EOF
[Unit]
Description=cc-bridge listener
After=network-online.target

[Service]
ExecStart=/usr/bin/env python3 %h/.cc-bridge/listener.py
Environment=CC_BRIDGE_BIND=$CC_BRIDGE_BIND
Environment=CC_BRIDGE_PORT=$PORT
Environment=CC_BRIDGE_SECRET=$CC_BRIDGE_SECRET
Environment=CC_BRIDGE_HOME=%h/.cc-bridge
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now cc-bridge.service
  loginctl enable-linger "$USER" 2>/dev/null || warn "could not enable linger; service may not start until you log in."
  say "systemd --user service started: $unit  (logs: journalctl --user -u cc-bridge -f)"
}

case "$OS" in
  Darwin) install_launchd ;;
  Linux)  install_systemd ;;
  *) echo "unsupported OS: $OS (macOS + Linux only)"; exit 1 ;;
esac

# ---- 6. health check ------------------------------------------------------
sleep 1
if curl -fsS "http://$CC_BRIDGE_BIND:$PORT/health" >/dev/null 2>&1; then
  say "listener healthy at http://$CC_BRIDGE_BIND:$PORT"
else
  warn "health check failed — see $HOME_DIR/logs/ (macOS) or journalctl --user -u cc-bridge (Linux)."
fi

# ---- 7. tell the user what to set on the PM server ------------------------
cat <<EOF

────────────────────────────────────────────────────────────────────────
Machine side done. Now set these on the PM server (the Pi), then restart it:

  CC_BRIDGE_URL=http://$CC_BRIDGE_BIND:$PORT
  CC_BRIDGE_SECRET=$CC_BRIDGE_SECRET
  CC_BRIDGE_READY_STATUS=todo

Docker Compose: add them under the web service 'environment:' and run
  docker compose up -d --build

No cron needed — the server drains its retry queue on its own timer.
Test: move any ticket into Ready, then  tail -f $HOME_DIR/logs/*.log
────────────────────────────────────────────────────────────────────────
EOF
