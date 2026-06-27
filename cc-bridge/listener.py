#!/usr/bin/env python3
"""cc-bridge listener — dev-machine side of the auto-runner.

Always-on HTTP listener. The Pi (this project's PM server) POSTs here when a
ticket enters Ready; we spawn run.py DETACHED to drive headless Claude Code for
that ticket, and return 202 immediately (never block on claude).

Ticket: "Machine: webhook listener + agent trigger" (Hv5nGMwRiigf).

Security / guardrails:
  - Bind the machine's Tailscale IP (CC_BRIDGE_BIND), never 0.0.0.0 or
    localhost — the Pi must reach it, the public internet must not.
  - Every request must carry  X-Secret == CC_BRIDGE_SECRET  (else 403).
  - project -> repo path comes from config.json; unknown project -> 404.

Deploy: copy this dir to ~/.cc-bridge/ ; run via launchd (see the plist).
Stdlib only — no pip install.
"""
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG_PATH = Path(os.environ.get("CC_BRIDGE_CONFIG", HERE / "config.json"))
RUNNER = HERE / "run.py"

BIND = os.environ.get("CC_BRIDGE_BIND", "").strip()
PORT = int(os.environ.get("CC_BRIDGE_PORT", "8787"))
SECRET = os.environ.get("CC_BRIDGE_SECRET", "").strip()


def load_config() -> dict:
    """Read config.json fresh per request so repo-map edits need no restart."""
    try:
        return json.loads(CONFIG_PATH.read_text())
    except FileNotFoundError:
        return {"projects": {}}


def repo_for(project: str) -> str | None:
    return (load_config().get("projects") or {}).get(project)


class Handler(BaseHTTPRequestHandler):
    # Quieter, single-line logging to stdout (launchd captures it).
    def log_message(self, fmt, *args):
        sys.stdout.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys.stdout.flush()

    def _send(self, code: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # Liveness probe (no secret needed; reveals nothing sensitive).
        if self.path == "/health":
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/take":
            return self._send(404, {"error": "not_found"})

        # Constant-ish secret gate. Reject before reading/spawning anything.
        if not SECRET or self.headers.get("X-Secret") != SECRET:
            return self._send(403, {"error": "forbidden"})

        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._send(400, {"error": "bad_request", "message": "invalid JSON"})

        ticket = body.get("id")
        project = body.get("project")
        action = body.get("action", "new")
        order = body.get("order", "")
        if not ticket or not project:
            return self._send(400, {"error": "bad_request", "message": "id and project required"})
        if action not in ("new", "resume"):
            return self._send(400, {"error": "bad_request", "message": "action must be new|resume"})

        repo = repo_for(project)
        if not repo:
            return self._send(404, {"error": "not_found", "message": f"unknown project {project}"})

        # Spawn the runner DETACHED: new session, fully redirected I/O, and we do
        # NOT wait. The HTTP 202 returns while claude runs in the background.
        env = {
            **os.environ,
            "TICKET": ticket,
            "PROJECT": project,
            "REPO": repo,
            "ACTION": action,
            "ORDER": order or "",
        }
        try:
            subprocess.Popen(
                [sys.executable, str(RUNNER)],
                env=env,
                cwd=repo,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,  # detach from the listener's process group
            )
        except Exception as e:  # noqa: BLE001 — surface spawn failure to caller
            return self._send(500, {"error": "spawn_failed", "message": str(e)})

        return self._send(202, {"ok": True, "ticket": ticket, "action": action})


def main():
    if not BIND:
        sys.exit(
            "CC_BRIDGE_BIND must be set:\n"
            "  cross-device  -> this machine's Tailscale IP (e.g. 100.x.y.z)\n"
            "  same-device   -> 127.0.0.1 (loopback; PM server is on the same box)"
        )
    # Refuse all-interfaces binds (would expose :PORT to every network). Loopback
    # (127.0.0.1) is allowed for same-device installs; a Tailscale IP for cross-
    # device. Both keep the listener off the public internet.
    if BIND in ("0.0.0.0", "::"):
        sys.exit(f"refusing to bind {BIND}: pick the Tailscale IP (cross-device) or 127.0.0.1 (same-device).")
    if not SECRET:
        sys.exit("CC_BRIDGE_SECRET must be set.")
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"cc-bridge listener on http://{BIND}:{PORT} (config: {CONFIG_PATH})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
