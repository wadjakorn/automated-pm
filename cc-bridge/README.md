# cc-bridge — auto-run ready tickets (poll model)

Move a ticket to **Ready** and a Claude Code routine on your dev machine picks
it up, implements it, opens a PR, and moves it to Code Review. No server to
install on the machine, no inbound listener, no Tailscale binding — the machine
**polls** the PM server.

## How it works

```
Claude Code (your machine, a built-in scheduled routine, every N min)
   pm ready --project <name> --json         # GET /api/cc-bridge/ready
   for each ready ticket:
     pm task move --id <id> --status doing   # claim (optimistic version = lock)
     implement → run tests → open PR
     pm task move --id <id> --status completed   # → Code Review
```

A claimed ticket leaves `todo`, so the next poll never returns it twice. Status
is the lock.

## One-time setup

1. **Opt a project in:** give it a remote repo URL so the routine knows where to
   work. Only projects with a repo URL appear in `pm ready`.

   ```bash
   pm project update --project "automated-pm" \
     --remote-url git@github.com:you/automated-pm.git --confirm
   ```

2. **Mint a token** (the `/ready` endpoint requires one — it triggers autonomous
   code execution, so it is not anonymous):

   ```bash
   pm user create --username poller --password "$(openssl rand -hex 16)"
   # copy the api_token from the output
   ```

3. **Env for the routine** (the machine that runs Claude Code):

   ```bash
   export PM_API=http://dietpi:3000        # your PM server URL
   export PM_TOKEN=<api_token from step 2>
   # NEVER set ANTHROPIC_API_KEY — the routine must use your Max subscription,
   # not the metered API.
   ```

4. **Install the routine in Claude Code.** Create a scheduled routine that runs
   every few minutes with this prompt (pin your project name):

   > Run `pm ready --project automated-pm --json`. For each ticket: claim it with
   > `pm task move --id <id> --status doing`, then implement it in the repo at its
   > `repo` URL — follow the repo's conventions, run its tests, open a PR with
   > `gh pr create`. On success move it to Code Review (`pm task move --id <id>
   > --status completed`). If blocked, `pm task move --id <id> --status blocked`
   > and append a STATUS note to the ticket describing why. Never set
   > `ANTHROPIC_API_KEY`. Keep secrets out of the repo.

   Omit `--project` to work every opted-in project at once. Running a **fleet**
   of machines? Give each one a distinct bot user and pin `--assignee <bot>` in
   its prompt — they split the ready tickets with no overlap.

## Notes & limits

- **Renaming a project breaks the pinned handle** — re-point the routine to the
  new name (or use the project id, which never changes).
- **A crashed run leaves a ticket in `doing`** (absent from `pm ready`). Nudge it
  back to `todo` to retry. Auto-recovery of stale `doing` tickets is future work.
- **Resume-on-PR-comment is not wired** in this model — to re-run a ticket, move
  it back to Ready or point the routine at it manually.
