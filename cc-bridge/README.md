# cc-bridge — ticket → headless Claude Code

Move a ticket to **Ready** on this Kanban and headless Claude Code auto-starts on
your dev machine, reads the ticket, and runs it end to end. Removes the manual
"open Claude Desktop → pick repo → prompt it" steps.

```
┌─────────────── Pi (dietpi) ───────────────┐         ┌────────── dev machine (Mac) ──────────┐
│  PM platform (this Next.js app)            │         │  listener.py  (launchd, KeepAlive)    │
│   • moveTask → Ready  ──emit──►            │  HTTP   │    POST /take  (X-Secret gate)        │
│   • webhook_deliveries queue (durable)     ├────────►│      └─ spawn run.py (DETACHED)       │
│   • scheduler auto-drains (no cron)        │ tailnet │           └─ claude -p … (Max sub)    │
│   • /api/cc-bridge/resume (PR/CI events)   │  :8787  │  sessions.json  ticket → session_id   │
└────────────────────────────────────────────┘         └───────────────────────────────────────┘
```

Two halves live in this repo:

| Half | Files | Tickets |
|------|-------|---------|
| **Pi-side** (runs inside this PM app) | `lib/webhook.ts`, hook in `lib/repo.ts`, `app/api/cc-bridge/{resume,tick}/route.ts`, `webhook_deliveries` table | RV-WzBu4hgwl, owYA2-wk8STO, PBaHTlaZNWHu |
| **Machine-side** (deploy to `~/.cc-bridge/`) | `cc-bridge/listener.py`, `run.py`, `install.sh`, `com.you.ccbridge.plist`, `config.json` | Hv5nGMwRiigf, dK0eSRV2g1f3, XFy-LLdzb4CB |

> The PM platform **is** this repo deployed on the Pi, so the Pi-side is built in.
> The machine-side files are checked in here too, then copied to `~/.cc-bridge/`.

---

## 0. Two topologies

| | **Cross-device** (PM server and claude on different boxes) | **Same-device** (both on one box) |
|---|---|---|
| Example | PM on a Pi, claude on a Mac (over a tailnet) | one laptop runs both |
| Listener bind (`CC_BRIDGE_BIND`) | this machine's **Tailscale IP** (`100.x.y.z`) | **`127.0.0.1`** (loopback) |
| Pi's `CC_BRIDGE_URL` | `http://<tailscale-ip>:8787` | `http://127.0.0.1:8787` |
| Needs Tailscale? | yes (or any private route Pi→machine) | no |

Both halves below apply to both topologies — only the bind/URL differ. A full
same-device walkthrough is in **§5**. The listener refuses `0.0.0.0`/`::` (would
expose `:8787` to every network); loopback and tailnet IPs are both allowed.

## 1. Pi-side (the PM server) — configuration

The bridge is **opt-in**: with no `CC_BRIDGE_URL` set, nothing fires and the board
behaves exactly as before. Set these env vars on the PM server:

| Var | Required | Meaning |
|-----|----------|---------|
| `CC_BRIDGE_URL` | yes | Machine listener base URL. Cross-device: `http://<tailscale-ip>:8787`. Same-device: `http://127.0.0.1:8787`. |
| `CC_BRIDGE_SECRET` | yes | Shared secret; sent as `X-Secret` on every call. Must match the machine. |
| `CC_BRIDGE_READY_STATUS` | no | Status key that triggers a run. Default `todo` (the "Ready" column). |

**Docker Compose** (this repo's `docker-compose.yml`) — add to the `web` service `environment:`:

```yaml
    environment:
      - NODE_ENV=production
      - PM_DB_PATH=/app/data/pm.db
      - CC_BRIDGE_URL=http://100.x.y.z:8787   # tailnet IP (or http://127.0.0.1:8787 same-device)
      - CC_BRIDGE_SECRET=<your-secret>
      - CC_BRIDGE_READY_STATUS=todo
```
then `docker compose up -d --build`. (systemd: put the same in `Environment=` /
an `EnvironmentFile`; pm2: an ecosystem `env` block.)

What each piece does:

- **Emit on Ready** (`lib/repo.ts` → `moveTask`): when a ticket transitions *into*
  the ready status, a delivery is enqueued and a non-blocking drain is kicked. The
  move API never waits on the network.
- **Retry queue** (`webhook_deliveries` table): a delivery is marked done **only**
  on HTTP `202`. Otherwise it is retried with exponential backoff
  (30s → 30m, up to 10 attempts, then parked as `dead`). A ticket queued while the
  machine is asleep fires once the machine is back. Duplicate Ready-moves while a
  delivery is still pending are de-duplicated (no double fire).
- **Automatic drain** (`lib/scheduler.ts`, started from `instrumentation.ts`):
  the server drains its own retry queue on a timer (`CC_BRIDGE_TICK_MS`, default
  30s) by calling its own `/api/cc-bridge/tick` over loopback. **No cron/systemd
  timer is needed.** A ticket queued while the machine slept fires within one
  tick of it waking. `POST /api/cc-bridge/tick` stays available for a manual or
  external nudge, but you don't have to schedule anything.

- **Resume endpoint** (`POST /api/cc-bridge/resume`): point a GitHub PR-comment /
  CI webhook here to continue the *same* ticket session:

  ```bash
  curl -X POST http://<pi>:3000/api/cc-bridge/resume \
    -H "X-Secret: $CC_BRIDGE_SECRET" \
    -d '{"id":"<ticket>","project":"<project-id>","order":"<PR comment or CI summary>"}'
  ```

  It enqueues an `action:"resume"` delivery through the same durable queue. The
  machine runner resumes the stored `session_id`. **Durable fallback:** the runner
  prompt tells claude to append a `STATUS` note to the ticket before stopping, so
  even if the local session file is gone a cold NEW run can pick up from the
  ticket/PR thread.

---

## 2. Machine-side — one command (macOS + Linux)

```bash
bash cc-bridge/install.sh
```

The installer (`install.sh`) does the whole machine side: checks prerequisites,
auto-detects the Tailscale IP (falls back to `127.0.0.1` for same-device),
prompts for the shared secret (or generates one) and the project→repo map,
copies `listener.py` + `run.py`, installs the keepalive service for your OS
(**launchd** on macOS, **systemd --user** on Linux), health-checks `:8787`, and
prints the exact `CC_BRIDGE_*` lines to paste on the PM server. Re-runnable.

Unattended (e.g. piped): pass values as env vars —
`CC_BRIDGE_SECRET=… CC_BRIDGE_BIND=… bash cc-bridge/install.sh`.

Before going live, the installer reminds you to set up subscription auth once:

```bash
claude setup-token     # Max-plan OAuth for `claude -p`, writes ~/.claude
env | grep ANTHROPIC   # must be EMPTY (no metered-API billing)
gh auth login          # runner opens PRs via gh
```

<details><summary>Manual setup (if you'd rather not use the installer)</summary>

```bash
mkdir -p ~/.cc-bridge/logs
cp cc-bridge/listener.py cc-bridge/run.py ~/.cc-bridge/
cp cc-bridge/config.example.json ~/.cc-bridge/config.json   # edit project->repo map
chmod +x ~/.cc-bridge/run.py
# macOS: fill REPLACE_ME_* and install the launchd plist
sed -e "s|REPLACE_ME_HOME|$HOME|g" -e "s|REPLACE_ME_TAILSCALE_IP|$(tailscale ip -4 | head -1)|g" \
    -e "s|REPLACE_ME_SHARED_SECRET|<secret>|g" \
    cc-bridge/com.you.ccbridge.plist > ~/Library/LaunchAgents/com.you.ccbridge.plist
launchctl load -w ~/Library/LaunchAgents/com.you.ccbridge.plist
curl -s http://<bind-ip>:8787/health   # -> {"ok": true}
```
</details>

The service runs with `RunAtLoad`/`KeepAlive` (launchd) or `Restart=always`
(systemd), so a reboot brings the listener back automatically.

### Sleep handling

A sleeping machine = unreachable listener, but deliveries are **durable**: they
queue on the PM server and the built-in scheduler (§1) redelivers within one tick
of the machine waking — nothing to configure. To eliminate the wake-up latency
during active sessions, optionally keep the machine awake (`caffeinate` on macOS,
`systemd-inhibit` / disable suspend on Linux).

---

## 3. End-to-end smoke test

```bash
# From the Pi (or any tailnet host), with the listener up:
curl -i -X POST http://<tailscale-ip>:8787/take \
  -H "X-Secret: $CC_BRIDGE_SECRET" \
  -d '{"id":"<ticket>","project":"<project-id>","action":"new"}'
# expect: HTTP/1.1 202 ; ~/.cc-bridge/logs/<project>-<ticket>.log shows the run

curl -s -o /dev/null -w '%{http_code}\n' -X POST http://<tailscale-ip>:8787/take \
  -H "X-Secret: wrong" -d '{}'                         # -> 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://<tailscale-ip>:8787/take \
  -H "X-Secret: $CC_BRIDGE_SECRET" \
  -d '{"id":"x","project":"nope","action":"new"}'      # -> 404 (unknown project)
```

Real trigger: move a ticket into **Ready** on the board → claude starts on the
machine with no manual step. Comment-driven resume: POST to `/api/cc-bridge/resume`.

---

## 4. Security / guardrails

- **Never all-interfaces.** The listener refuses `0.0.0.0` / `::`. Cross-device it
  binds the Tailscale IP (tailnet-only); same-device it binds `127.0.0.1`
  (loopback-only). Either way `:8787` stays off the public internet.
- **Shared secret** on every call (`X-Secret`); mismatch ⇒ 403. Constant-time
  compared on the Pi side.
- **No secrets in the repo.** `config.json`, the secret, and the launchd plist's
  filled-in values live only under `~/.cc-bridge` / `~/Library/LaunchAgents`.
  Only `*.example`/`REPLACE_ME` templates are committed.
- **Subscription auth.** `run.py` strips `ANTHROPIC_API_KEY` so a run can never
  bill the metered API.
- **Idempotent.** Deliveries de-dupe while pending and only complete on `202`.

---

## 5. Same-device install (PM server + claude on one box)

Everything on one machine — no Tailscale, listener on loopback. The only changes
vs §1–§2 are the bind (`127.0.0.1`) and the URL.

```bash
# 1. Machine side — installer, bound to loopback:
CC_BRIDGE_BIND=127.0.0.1 bash cc-bridge/install.sh
claude setup-token ; env | grep ANTHROPIC          # must be empty

# 2. PM server env (however you run it):
#    CC_BRIDGE_URL=http://127.0.0.1:8787  CC_BRIDGE_SECRET=<secret>  CC_BRIDGE_READY_STATUS=todo
#    (the scheduler drains automatically — no cron.)
```

Notes: no firewall prompt (loopback never leaves the box). If the PM server runs
**inside Docker** and the listener on the host, set the container's
`CC_BRIDGE_URL=http://host.docker.internal:8787` (or use `network_mode: host`) so
the container can reach the host listener.
