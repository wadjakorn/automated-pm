#!/usr/bin/env -S tsx
/**
 * pm — flag-based CLI for the Project Manager API.
 * Output is TTY-aware: a terminal gets pretty tables, a pipe gets JSON.
 * `--json`/`--pretty` force a mode; `--no-color` / NO_COLOR disable color.
 * Exit 0 on success, non-zero on error. All rules are enforced server-side.
 *
 * Base URL: --api <url>, else PM_API, else http://localhost:3000.
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveGlobals } from "./mode";
import { render, renderError, type Kind } from "./render";

const R = resolveGlobals({
  argv: process.argv.slice(2),
  isTTY: !!process.stdout.isTTY,
  env: process.env,
});
const BASE = R.api;
// Optional auth: PM_TOKEN attributes created tasks to that user.
const TOKEN = process.env.PM_TOKEN;

type Flags = Record<string, string | boolean>;

// Flags that are switches. Every other flag needs a value, and a bare one
// (`pm task update --title`) is a usage error instead of a silent `true`.
export const SWITCHES = new Set([
  "stdin",
  "final",
  "include-deleted",
  "include-archived",
  "unassign",
  "confirm",
  "hidden",
]);

// `--key value` or `--key=value`. The `=` form is how to pass a value that
// itself starts with `--` (e.g. --title=--draft--).
export function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const eq = tok.indexOf("=");
    if (eq > 2) {
      flags[tok.slice(2, eq)] = tok.slice(eq + 1);
      continue;
    }
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

// First flag that should carry a value but doesn't, if any.
export function bareValueFlag(f: Flags): string | undefined {
  return Object.keys(f).find((k) => f[k] === true && !SWITCHES.has(k));
}

// Every `pm <group> <action>` the CLI knows, for did-you-mean suggestions.
export const COMMANDS = [
  "user create", "user list", "login", "whoami", "token rotate",
  "project create", "project list", "project update", "project delete",
  "project restore", "project archive", "project unarchive", "project reorder",
  "status list", "status add", "status set-final", "status update", "status remove",
  "transition add", "transition remove",
  "task create", "task list", "task get", "task move", "task update",
  "task delete", "task restore", "task archive", "task unarchive", "task archive-final",
  "task link add", "task link list", "task link rm",
  "board", "ready", "help",
  "comment", "log", "inbox", "resolve", "events", "search", "mine",
];

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
  return d[a.length][b.length];
}

// Up to 3 known commands close to what was typed (same group first).
export function suggest(typed: string): string[] {
  const t = typed.trim();
  return COMMANDS.map((c) => ({ c, d: editDistance(t, c) - (c.split(" ")[0] === t.split(" ")[0] ? 1 : 0) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(t.length / 3)))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.c);
}

// Thrown by finish() to unwind out of main() once the final output is queued.
class CliExit extends Error {
  constructor(readonly code: number) {
    super(`cli exit ${code}`);
  }
}

// The single way the CLI ends: queue the final output, record the exit code and
// unwind. Never call process.exit() here — stdout to a pipe is asynchronous in
// Node, so exiting right after write() truncates large output (e.g. a ~300KB
// `task list --json` piped into jq). Letting the process end naturally keeps it
// alive until stdout has fully drained.
function finish(text: string, code: number): never {
  process.exitCode = code;
  process.stdout.write(text + "\n");
  throw new CliExit(code);
}

// Render an API response and exit. Success → render(kind); failure → renderError.
function emit(kind: Kind, r: { status: number; json: any }): never {
  const ok = r.status >= 200 && r.status < 300;
  const data = r.json ?? (ok ? { ok: true } : { error: "http_" + r.status });
  const text = ok ? render(kind, data, R) : renderError(data, R);
  finish(text, ok ? 0 : 1);
}

function fail(message: string, extra: Record<string, unknown> = {}): never {
  finish(renderError({ error: "cli_error", message, ...extra }, R), 1);
}

async function api(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {};
  if (body) headers["content-type"] = "application/json";
  if (TOKEN) headers["authorization"] = `Bearer ${TOKEN}`;
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch (e: any) {
    // Network failure (server down): surface a clear, hinted cli_error.
    return {
      status: 0,
      json: { error: "cli_error", message: `Cannot reach ${BASE}: ${e?.message ?? e}` },
    };
  }
}

const need = (f: Flags, k: string): string => {
  const v = f[k];
  if (typeof v !== "string" || v === "") fail(`--${k} is required`);
  return v as string;
};

// Optional integer flag (e.g. --version): a non-number is a usage error, not
// a NaN that the server would read as a version mismatch.
const int = (f: Flags, k: string): number | undefined => {
  const v = f[k];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !/^\d+$/.test(v)) fail(`--${k} must be a whole number`);
  return Number(v);
};

// --view summary|full for list/board (summary trims descriptions).
const viewQs = (f: Flags, qs: URLSearchParams) => {
  if (f.view === undefined) return;
  if (f.view !== "summary" && f.view !== "full") fail("--view must be summary or full");
  qs.set("view", f.view as string);
};

// --project accepts an id OR a project name; the server resolves either.
// URL-encode it because a name may contain spaces/slashes when used in a path.
const proj = (f: Flags): string => encodeURIComponent(need(f, "project"));

const HELP = `pm — Project Manager CLI

  # Set PM_TOKEN=<api_token>. Reads never need it; writes do on a write-token server.
  pm user create --username <u> --password <p> [--kind human|agent]   # -> { user, api_token }
  pm user list
  pm login --username <u> --password <p>          # check credentials (-> { user }); does NOT return a token
  pm token rotate --username <u> --password <p>   # -> { api_token } new token, old one stops working; export PM_TOKEN
  pm whoami                                        # current user (needs PM_TOKEN) or null

  pm project create --name <name> [--description <text>]
  pm project list [--include-archived] [--include-deleted]
  # changing --name or --remote-url is a guarded edit: it needs --confirm.
  pm project update --project <id|name> [--name <new>] [--description <text>] [--remote-url <url>] [--default-status <key>] [--ready-status <key>] [--hidden <true|false>] [--confirm]
  pm project delete --project <id|name>
  pm project restore --project <id|name>              # bring a trashed project back
  pm project archive --project <id|name>              # file off the sidebar (stays live)
  pm project unarchive --project <id|name>
  pm project reorder --ids <id1,id2,...>              # persist a new sidebar order

  # --project accepts a project id OR its (unique) name, e.g. --project 'demo'
  pm status list --project <id|name>
  pm status add --project <id|name> --key <key> --label <label> [--final]
  pm status set-final --project <id|name> --key <key> --final <true|false>
  pm status update --project <id|name> --key <key> [--label <l>] [--final <true|false>] [--order <n>] [--hidden <true|false>]
  pm status remove --project <id|name> --key <key>

  pm transition add --project <id|name> --from <key> --to <key>
  pm transition remove --project <id|name> --from <key> --to <key>

  # --assignee accepts a user id OR username; --priority is low|medium|high|now (default medium)
  pm task create --project <id|name> --title <title> [--description <text>] [--status <key>] [--assignee <id|username>] [--priority <p>]
  pm task create --project <id|name> --stdin   # one task per non-empty stdin line, all-or-nothing
  # aliases: \`ls\`=list, \`mv\`=move, \`rm\`=delete (e.g. pm task ls --project demo)
  # task list auto-sorts each status by priority (now→high→medium→low), then rank
  # --view summary trims descriptions to a 200-char excerpt (much smaller output)
  pm task list --project <id|name> [--status <key>] [--include-deleted] [--include-archived] [--assignee <id|username>] [--priority <p>] [--view summary|full]
  # every --id below accepts the nanoid OR the human ticket key (e.g. PM-0002)
  pm task get --id <id|key> [--include-deleted]   # fetch one task directly
  # --from <key>: move only if the ticket is still in <key> (claim); else 409 status_changed
  pm task move --id <id|key> --status <key> [--from <key>] [--version <n>]
  pm task update --id <id|key> [--title <t>] [--description <text>] [--version <n>] [--assignee <id|username> | --unassign] [--priority <p>]
  pm task delete --id <id|key>
  pm task restore --id <id|key>

  # archive — file finished tickets off the board (stay live: direct link + search).
  # only tickets in a FINAL status can be archived. archive-final does it in bulk.
  pm task archive --id <id|key>
  pm task unarchive --id <id|key>
  pm task archive-final --project <id|name> --status <final-key>

  # ticket links — --to accepts a ticket URL, bare id, or ticket key; --type is
  # one of blocks | blocked-by | causes | caused-by | relates
  pm task link add  --id <id|key> --to <url|id|key> --type <type>
  pm task link list --id <id|key>
  pm task link rm   --id <id|key> --link <linkId>

  pm board --project <id|name> [--view summary]   # columns view: tasks grouped by status

  # comments & history — kind: note (default) | question (goes to the inbox) |
  # answer (--reply-to <question id> resolves it) | handoff (summary for the next owner)
  pm comment --id <id|key> (--body <text> | --body-file <path|->) [--kind <k>] [--reply-to <commentId>]
  pm log --id <id|key> [--since <seq>] [--limit <n>]      # ticket history: comments + changes
  pm inbox [--project <id|name>] [--assignee <id|username>]   # open questions waiting for a human
  pm resolve --comment <commentId>                         # close a question without answering
  pm events [--since <seq>] [--project <id|name>] [--limit <n>]   # cross-ticket change feed

  # search & home — search spans projects, titles, descriptions and comments (Thai ok)
  pm search <words…> [--project <p>] [--status <key>] [--assignee <u>] [--limit <n>] [--include-deleted]
  pm mine [--user <id|username>]   # my open tickets across projects + agents at work + inbox count
  # values that start with -- use the = form: --title=--draft--
  pm ready [--project <id|name>] [--assignee <id|username>]   # ready tickets (repo + desc) for the poll routine
`;

const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();

export const ALIAS: Record<string, string> = { ls: "list", mv: "move", rm: "delete" };

async function board(f: Flags): Promise<never> {
  const ref = need(f, "project");
  const pid = encodeURIComponent(ref);
  const smR = await api("GET", `/api/projects/${pid}/statuses`);
  if (!(smR.status >= 200 && smR.status < 300)) return emit("board", smR); // renders error
  const qs = new URLSearchParams({ project: ref });
  viewQs(f, qs);
  const tR = await api("GET", `/api/tasks?${qs.toString()}`);
  if (!(tR.status >= 200 && tR.status < 300)) return emit("board", tR);
  const statuses = smR.json.statuses ?? [];
  const tasks = (tR.json ?? []) as any[];
  const columns = statuses.map((s: any) => ({
    status: s,
    tasks: tasks.filter((t) => t.status_key === s.key),
  }));
  return emit("board", { status: 200, json: { project: ref, columns } });
}

async function main() {
  if (R.showVersion) {
    finish(`pm ${VERSION}`, 0);
  }

  const [group, rawAction, ...rest] = R.argv;
  const action = ALIAS[rawAction] ?? rawAction;

  if (!group || group === "help" || group === "--help") {
    finish(R.mode === "json" ? JSON.stringify({ help: HELP }, null, 2) : HELP, 0);
  }

  // Single-word commands: flags live in [rawAction, ...rest].
  if (["login", "whoami", "board", "ready", "comment", "log", "inbox", "resolve", "events", "search", "mine"].includes(group)) {
    const sf = parseFlags([rawAction, ...rest].filter((x): x is string => !!x));
    const bareS = bareValueFlag(sf);
    if (bareS) fail(`--${bareS} needs a value (use --${bareS}=<value> if it starts with --)`);
    if (group === "whoami") return emit("raw", await api("GET", "/api/auth/me"));
    if (group === "login")
      return emit(
        "raw",
        await api("POST", "/api/auth/login", {
          username: need(sf, "username"),
          password: need(sf, "password"),
        })
      );
    if (group === "comment") {
      // --body <text> or --body-file <path|-> (stdin) for long markdown.
      let body: string | undefined = typeof sf.body === "string" ? sf.body : undefined;
      if (typeof sf["body-file"] === "string")
        body = readFileSync(sf["body-file"] === "-" ? 0 : sf["body-file"], "utf8");
      if (!body?.trim()) fail("--body or --body-file is required");
      return emit(
        "activity",
        await api("POST", `/api/tasks/${encodeURIComponent(need(sf, "id"))}/comments`, {
          body,
          kind: typeof sf.kind === "string" ? sf.kind : undefined,
          reply_to: typeof sf["reply-to"] === "string" ? sf["reply-to"] : undefined,
        })
      );
    }
    if (group === "log") {
      const qs = new URLSearchParams();
      if (typeof sf.since === "string") qs.set("since", sf.since);
      if (typeof sf.limit === "string") qs.set("limit", sf.limit);
      const q = qs.toString() ? `?${qs}` : "";
      return emit(
        "activity",
        await api("GET", `/api/tasks/${encodeURIComponent(need(sf, "id"))}/activity${q}`)
      );
    }
    if (group === "inbox") {
      const qs = new URLSearchParams();
      if (typeof sf.project === "string") qs.set("project", sf.project);
      if (typeof sf.assignee === "string") qs.set("assignee", sf.assignee);
      const q = qs.toString() ? `?${qs}` : "";
      return emit("inbox", await api("GET", `/api/inbox${q}`));
    }
    if (group === "resolve")
      return emit(
        "activity",
        await api("POST", `/api/comments/${encodeURIComponent(need(sf, "comment"))}/resolve`)
      );
    if (group === "events") {
      const qs = new URLSearchParams();
      if (typeof sf.since === "string") qs.set("since", sf.since);
      if (typeof sf.project === "string") qs.set("project", sf.project);
      if (typeof sf.limit === "string") qs.set("limit", sf.limit);
      const q = qs.toString() ? `?${qs}` : "";
      return emit("activity", await api("GET", `/api/events${q}`));
    }
    if (group === "search") {
      // `pm search <words…>` or `pm search --query "<words>"`.
      const words = [rawAction, ...rest].filter((x): x is string => !!x);
      const positional: string[] = [];
      for (let i = 0; i < words.length; i++) {
        if (words[i].startsWith("--")) {
          if (!words[i].includes("=") && words[i + 1] !== undefined && !words[i + 1].startsWith("--")) i++;
          continue;
        }
        positional.push(words[i]);
      }
      const q = typeof sf.query === "string" ? sf.query : positional.join(" ");
      if (!q.trim()) fail("give search words: pm search <words> (or --query)");
      const qs = new URLSearchParams({ q });
      for (const k of ["project", "status", "assignee", "limit"])
        if (typeof sf[k] === "string") qs.set(k, sf[k] as string);
      if (sf["include-deleted"]) qs.set("includeDeleted", "true");
      return emit("search", await api("GET", `/api/search?${qs}`));
    }
    if (group === "mine") {
      const qs = new URLSearchParams();
      if (typeof sf.user === "string") qs.set("user", sf.user);
      const q = qs.toString() ? `?${qs}` : "";
      return emit("overview", await api("GET", `/api/overview${q}`));
    }
    if (group === "ready") {
      const qs = new URLSearchParams();
      if (typeof sf.project === "string") qs.set("project", sf.project);
      if (typeof sf.assignee === "string") qs.set("assignee", sf.assignee);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return emit("ready", await api("GET", `/api/cc-bridge/ready${q}`));
    }
    // board — Task 7 fills this in.
    return board(sf);
  }

  // `task link <add|list|rm>` has a sub-action positional, so it can't use the
  // flat `${group} ${action}` switch — handle it before flags are parsed.
  if (group === "task" && rawAction === "link") {
    // Match the user-facing sub-action verbatim (not via ALIAS) so the cases
    // read the same as what the user types.
    const sub = rest[0];
    const lf = parseFlags(rest.slice(1));
    switch (sub) {
      case "add":
        return emit(
          "raw",
          await api("POST", `/api/tasks/${need(lf, "id")}/links`, {
            targetRef: need(lf, "to"),
            type: need(lf, "type"),
          })
        );
      case "list":
      case "ls":
        return emit("raw", await api("GET", `/api/tasks/${need(lf, "id")}/links`));
      case "rm":
      case "remove":
        return emit(
          "ok",
          await api(
            "DELETE",
            `/api/tasks/${need(lf, "id")}/links/${need(lf, "link")}`
          )
        );
      default:
        fail(`unknown command "task link ${rest[0] ?? ""}"`, {
          did_you_mean: suggest(`task link ${rest[0] ?? ""}`),
          hint: "pm help",
        });
    }
  }

  const f = parseFlags(rest);
  const bare = bareValueFlag(f);
  if (bare) fail(`--${bare} needs a value (use --${bare}=<value> if it starts with --)`);

  switch (`${group} ${action}`) {
    case "user create":
      return emit(
        "raw",
        await api("POST", "/api/auth/register", {
          username: need(f, "username"),
          password: need(f, "password"),
          kind: typeof f.kind === "string" ? f.kind : undefined,
        })
      );
    case "token rotate":
      return emit(
        "raw",
        await api("POST", "/api/auth/token", {
          username: need(f, "username"),
          password: need(f, "password"),
        })
      );
    case "user list":
      return emit("raw", await api("GET", "/api/users"));

    case "project create":
      return emit(
        "project",
        await api("POST", "/api/projects", {
          name: need(f, "name"),
          description: f.description,
        })
      );
    case "project list": {
      const qs = new URLSearchParams();
      if (f["include-archived"]) qs.set("includeArchived", "true");
      if (f["include-deleted"]) qs.set("includeDeleted", "true");
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return emit("projects", await api("GET", `/api/projects${q}`));
    }
    case "project update":
      return emit(
        "project",
        await api("PATCH", `/api/projects/${proj(f)}`, {
          name: typeof f.name === "string" ? f.name : undefined,
          description: typeof f.description === "string" ? f.description : undefined,
          // --remote-url '' clears it; the server normalizes/validates.
          remote_repo_url:
            typeof f["remote-url"] === "string" ? f["remote-url"] : undefined,
          // --default-status '' clears it (→ first status); server validates key.
          default_status_key:
            typeof f["default-status"] === "string" ? f["default-status"] : undefined,
          // --ready-status '' clears it (→ todo); the ready/accept-gate status.
          ready_status_key:
            typeof f["ready-status"] === "string" ? f["ready-status"] : undefined,
          // --hidden true|false hides/shows the project in the web sidebar.
          hidden:
            f.hidden === undefined ? undefined : f.hidden === "true" || f.hidden === true,
          // Guard: the server rejects a name/URL change unless confirm is true.
          confirm: f.confirm === true,
        })
      );
    case "project delete":
      return emit("ok", await api("DELETE", `/api/projects/${proj(f)}`));
    case "project restore":
      return emit("project", await api("POST", `/api/projects/${proj(f)}/restore`));
    case "project archive":
      return emit("project", await api("POST", `/api/projects/${proj(f)}/archive`));
    case "project unarchive":
      return emit("project", await api("POST", `/api/projects/${proj(f)}/unarchive`));
    case "project reorder":
      // --ids is a comma-separated ordered list of project ids.
      return emit(
        "projects",
        await api("POST", "/api/projects/reorder", {
          ids: need(f, "ids")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        })
      );

    case "status list":
      return emit("statemachine", await api("GET", `/api/projects/${proj(f)}/statuses`));
    case "status add":
      return emit(
        "statemachine",
        await api("POST", `/api/projects/${proj(f)}/statuses`, {
          key: need(f, "key"),
          label: f.label,
          is_final: !!f.final,
        })
      );
    case "status set-final":
      return emit(
        "statemachine",
        await api("PATCH", `/api/projects/${proj(f)}/statuses`, {
          key: need(f, "key"),
          is_final: f.final === "true" || f.final === true,
        })
      );
    case "status update":
      return emit(
        "statemachine",
        await api("PATCH", `/api/projects/${proj(f)}/statuses`, {
          key: need(f, "key"),
          label: typeof f.label === "string" ? f.label : undefined,
          is_final:
            f.final === undefined ? undefined : f.final === "true" || f.final === true,
          sort_order: typeof f.order === "string" ? Number(f.order) : undefined,
          hidden:
            f.hidden === undefined ? undefined : f.hidden === "true" || f.hidden === true,
        })
      );
    case "status remove":
      return emit(
        "statemachine",
        await api(
          "DELETE",
          `/api/projects/${proj(f)}/statuses?key=${encodeURIComponent(need(f, "key"))}`
        )
      );

    case "transition add":
      return emit(
        "statemachine",
        await api("POST", `/api/projects/${proj(f)}/transitions`, {
          from: need(f, "from"),
          to: need(f, "to"),
        })
      );
    case "transition remove":
      return emit(
        "statemachine",
        await api(
          "DELETE",
          `/api/projects/${proj(f)}/transitions?from=${encodeURIComponent(
            need(f, "from")
          )}&to=${encodeURIComponent(need(f, "to"))}`
        )
      );

    case "task create": {
      if (f.stdin) {
        // One task per line, created atomically: a bad line creates nothing,
        // so a retry can't duplicate the lines that went through.
        const titles = readFileSync(0, "utf8")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        const common = {
          status: typeof f.status === "string" ? f.status : undefined,
          assignee: typeof f.assignee === "string" ? f.assignee : undefined,
          priority: typeof f.priority === "string" ? f.priority : undefined,
        };
        return emit(
          "tasks",
          await api("POST", "/api/tasks/batch", {
            project: need(f, "project"),
            tasks: titles.map((title) => ({ title, ...common })),
          })
        );
      }
      return emit(
        "task",
        await api("POST", "/api/tasks", {
          project: need(f, "project"),
          title: need(f, "title"),
          description: f.description,
          status: f.status,
          assignee: typeof f.assignee === "string" ? f.assignee : undefined,
          priority: typeof f.priority === "string" ? f.priority : undefined,
        })
      );
    }
    case "task get": {
      const qs = new URLSearchParams();
      if (f["include-deleted"]) qs.set("includeDeleted", "true");
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return emit("taskdetail", await api("GET", `/api/tasks/${need(f, "id")}${q}`));
    }
    case "task list": {
      const qs = new URLSearchParams({ project: need(f, "project") });
      if (typeof f.status === "string") qs.set("status", f.status);
      if (f["include-deleted"]) qs.set("includeDeleted", "true");
      if (f["include-archived"]) qs.set("includeArchived", "true");
      if (typeof f.assignee === "string") qs.set("assignee", f.assignee);
      if (typeof f.priority === "string") qs.set("priority", f.priority);
      viewQs(f, qs);
      return emit("tasks", await api("GET", `/api/tasks?${qs.toString()}`));
    }
    case "task move":
      return emit(
        "task",
        await api("PATCH", `/api/tasks/${need(f, "id")}`, {
          status: need(f, "status"),
          expect_from: typeof f.from === "string" ? f.from : undefined,
          version: int(f, "version"),
        })
      );
    case "task update": {
      // assignee: --assignee <ref> sets it; --unassign clears it; neither omits.
      let assignee: string | null | undefined;
      if (f.unassign) assignee = null;
      else if (typeof f.assignee === "string") assignee = f.assignee;
      return emit(
        "task",
        await api("PATCH", `/api/tasks/${need(f, "id")}`, {
          title: f.title,
          description: f.description,
          version: int(f, "version"),
          assignee,
          priority: typeof f.priority === "string" ? f.priority : undefined,
        })
      );
    }
    case "task delete":
      return emit("ok", await api("DELETE", `/api/tasks/${need(f, "id")}`));
    case "task restore":
      return emit("task", await api("POST", `/api/tasks/${need(f, "id")}/restore`));
    case "task archive":
      return emit("task", await api("POST", `/api/tasks/${need(f, "id")}/archive`, {}));
    case "task unarchive":
      return emit("task", await api("POST", `/api/tasks/${need(f, "id")}/unarchive`));
    case "task archive-final":
      return emit(
        "tasks",
        await api("POST", "/api/tasks/archive", {
          project: need(f, "project"),
          status: need(f, "status"),
        }).then((r) => ({
          status: r.status,
          json: r.json?.archived ?? r.json,
        }))
      );

    default: {
      const typed = [group, action].filter(Boolean).join(" ");
      fail(`unknown command "${typed}"`, { did_you_mean: suggest(typed), hint: "pm help" });
    }
  }
}

// Only run main() when this file is the entry point — resolve symlinks so the
// installed `pm` bin (a symlink to this file) still executes, while `import`
// from a test does not.
function isEntrypoint(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

// Run main() and turn any outcome into output + exit code without process.exit(),
// so buffered stdout always drains before the process ends.
async function run(entry: () => Promise<unknown>): Promise<void> {
  try {
    await entry();
  } catch (e: any) {
    if (e instanceof CliExit) return;
    try {
      fail(String(e?.message ?? e));
    } catch (e2) {
      if (!(e2 instanceof CliExit)) throw e2;
    }
  }
}

if (isEntrypoint()) {
  // A reader that closes early (`pm ... | head`) is not an error worth a stack trace.
  process.stdout.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EPIPE") process.exit(process.exitCode ?? 0);
    throw e;
  });
  void run(main);
}
