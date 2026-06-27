#!/usr/bin/env python3
"""cc-bridge runner — drives headless Claude Code for ONE ticket.

Cross-OS (macOS + Linux) replacement for run.sh: Python stdlib only, so no
bash / flock(1) / jq dependency. Spawned by listener.py with env:
  TICKET PROJECT REPO ACTION ORDER  (+ CC_BRIDGE_HOME, PM_API).

  ACTION=new    -> full end-to-end flow (read ticket -> doing -> implement ->
                   test -> PR -> Code Review), fresh claude session.
  ACTION=resume -> claude -p --resume <stored session_id> with ORDER text;
                   no stored id -> cold NEW run.

Session continuity: sessions.json maps ticket_id -> claude session_id, written
atomically (os.replace). Concurrency: a real fcntl.flock per repo serializes
tickets sharing a working tree. Auth: ANTHROPIC_API_KEY is removed from the
child env so claude uses the Max subscription, never the metered API.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

try:
    import fcntl  # POSIX (macOS + Linux); absent on Windows (unsupported here)
except ImportError:  # pragma: no cover
    fcntl = None

BRIDGE_HOME = Path(os.environ.get("CC_BRIDGE_HOME", Path.home() / ".cc-bridge"))
SESSIONS = BRIDGE_HOME / "sessions.json"
LOG_DIR = BRIDGE_HOME / "logs"

TICKET = os.environ.get("TICKET", "")
PROJECT = os.environ.get("PROJECT", "")
REPO = os.environ.get("REPO", "")
ACTION = os.environ.get("ACTION", "new")
ORDER = os.environ.get("ORDER", "")
PM_API = os.environ.get("PM_API", "http://dietpi:3000")

COMMON_FLAGS = [
    "--output-format", "json",
    "--allowedTools", "Bash,Read,Edit,Write,Grep,Glob",
    "--permission-mode", "acceptEdits",
]


def die(msg: str, code: int = 1):
    sys.stderr.write(msg + "\n")
    sys.exit(code)


def slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", s)


def log(logfile: Path, msg: str):
    with logfile.open("a") as f:
        f.write(f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] {msg}\n")


def get_session() -> str:
    try:
        return json.loads(SESSIONS.read_text()).get(TICKET, "")
    except (FileNotFoundError, json.JSONDecodeError):
        return ""


def save_session(sid: str):
    if not sid:
        return
    try:
        data = json.loads(SESSIONS.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    data[TICKET] = sid
    tmp = SESSIONS.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2))
    os.replace(tmp, SESSIONS)  # atomic


def new_prompt() -> str:
    return f"""You are an autonomous coding agent running headless on a dev machine. Work the
ticket end to end. PM server is at {PM_API} and is driven by the `pm` CLI.

Ticket: {TICKET}   Project: {PROJECT}   Repo: {REPO}

Steps:
1. Read the ticket: pm task list --project "{PROJECT}" --json  (find id "{TICKET}"), read its description.
2. Move it to in-progress: pm task move --id "{TICKET}" --status doing
3. Implement the change in this repo ({REPO}). Follow existing conventions.
4. Run the test/build suite. Fix failures.
5. Commit on a feature branch and open a PR (gh pr create).
6. Move the ticket to Code Review: pm task move --id "{TICKET}" --status completed
7. Before stopping — for ANY outcome, done OR blocked — append a STATUS line to
   the ticket so a future cold session can resume:
   pm task update --id "{TICKET}" --description "<existing desc>\\n\\n---\\nSTATUS: <what you did / why blocked / PR link>"
   If blocked, instead: pm task move --id "{TICKET}" --status blocked  then write the STATUS note.

Guardrails: never set ANTHROPIC_API_KEY. Keep secrets out of the repo. Idempotent."""


def run_claude(prompt_or_order: str, resume_sid: str, logfile: Path) -> str:
    # Subscription auth: strip any API credentials from the child environment.
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
    env["PM_API"] = PM_API
    cmd = ["claude", "-p", prompt_or_order]
    if resume_sid:
        cmd += ["--resume", resume_sid]
    cmd += COMMON_FLAGS
    proc = subprocess.run(cmd, cwd=REPO, env=env, capture_output=True, text=True)
    if proc.stderr:
        log(logfile, "stderr: " + proc.stderr.strip()[:2000])
    log(logfile, "stdout: " + proc.stdout.strip()[:4000])
    return proc.stdout


def parse_session_id(out: str) -> str:
    try:
        return json.loads(out).get("session_id", "") or ""
    except (json.JSONDecodeError, AttributeError):
        return ""


def main():
    for name, val in (("TICKET", TICKET), ("PROJECT", PROJECT), ("REPO", REPO)):
        if not val:
            die(f"{name} required")
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logfile = LOG_DIR / f"{slug(PROJECT)}-{slug(TICKET)}.log"
    if not Path(REPO).is_dir():
        log(logfile, f"repo not found: {REPO}")
        die(f"repo not found: {REPO}")

    # --- per-repo lock (real fcntl.flock; auto-released when this process exits) ---
    lock_path = Path("/tmp") / f"cc-{slug(PROJECT)}.lock"
    lock_fd = open(lock_path, "w")
    if fcntl is not None:
        log(logfile, "waiting for repo lock")
        fcntl.flock(lock_fd, fcntl.LOCK_EX)  # blocks until the other ticket finishes
    log(logfile, f"start action={ACTION} ticket={TICKET} project={PROJECT} repo={REPO}")

    sid = get_session() if ACTION == "resume" else ""
    if ACTION == "resume" and sid:
        text = ORDER or "Continue working this ticket; new feedback arrived."
        out = run_claude(text, sid, logfile)
    else:
        if ACTION == "resume":
            log(logfile, "resume requested but no stored session; cold NEW run")
        out = run_claude(new_prompt(), "", logfile)

    new_sid = parse_session_id(out)
    save_session(new_sid)
    log(logfile, f"done action={ACTION} ticket={TICKET} session={new_sid or 'unknown'}")
    # lock_fd closes at process exit -> flock released.


if __name__ == "__main__":
    main()
