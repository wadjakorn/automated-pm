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

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
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

// Render an API response and exit. Success → render(kind); failure → renderError.
function emit(kind: Kind, r: { status: number; json: any }): never {
  const ok = r.status >= 200 && r.status < 300;
  const data = r.json ?? (ok ? { ok: true } : { error: "http_" + r.status });
  const text = ok ? render(kind, data, R) : renderError(data, R);
  process.stdout.write(text + "\n");
  process.exit(ok ? 0 : 1);
}

function fail(message: string, extra: Record<string, unknown> = {}): never {
  process.stdout.write(renderError({ error: "cli_error", message, ...extra }, R) + "\n");
  process.exit(1);
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

// --project accepts an id OR a project name; the server resolves either.
// URL-encode it because a name may contain spaces/slashes when used in a path.
const proj = (f: Flags): string => encodeURIComponent(need(f, "project"));

const HELP = `pm — Project Manager CLI

  # Auth is OPTIONAL. Set PM_TOKEN=<api_token> to attribute created tasks to you.
  pm user create --username <u> --password <p>   # -> { user, api_token }
  pm user list
  pm login --username <u> --password <p>          # -> { api_token }; export PM_TOKEN
  pm whoami                                        # current user (needs PM_TOKEN) or null

  pm project create --name <name> [--description <text>]
  pm project list
  pm project update --project <id|name> [--name <new>] [--description <text>]
  pm project delete --project <id|name>

  # --project accepts a project id OR its (unique) name, e.g. --project 'demo'
  pm status list --project <id|name>
  pm status add --project <id|name> --key <key> --label <label> [--final]
  pm status set-final --project <id|name> --key <key> --final <true|false>
  pm status update --project <id|name> --key <key> [--label <l>] [--final <true|false>] [--order <n>]
  pm status remove --project <id|name> --key <key>

  pm transition add --project <id|name> --from <key> --to <key>
  pm transition remove --project <id|name> --from <key> --to <key>

  # --assignee accepts a user id OR username; --priority is low|medium|high|now (default medium)
  pm task create --project <id|name> --title <title> [--description <text>] [--status <key>] [--assignee <id|username>] [--priority <p>]
  pm task create --project <id|name> --stdin   # one task per non-empty stdin line
  # aliases: \`ls\`=list, \`mv\`=move, \`rm\`=delete (e.g. pm task ls --project demo)
  # task list auto-sorts each status by priority (now→high→medium→low), then rank
  pm task list --project <id|name> [--status <key>] [--include-deleted] [--assignee <id|username>] [--priority <p>]
  pm task move --id <id> --status <key> [--version <n>]
  pm task update --id <id> [--title <t>] [--description <text>] [--version <n>] [--assignee <id|username> | --unassign] [--priority <p>]
  pm task delete --id <id>
  pm task restore --id <id>

  # ticket links — --to accepts a ticket URL or bare id; --type is one of
  # blocks | blocked-by | causes | caused-by | relates
  pm task link add  --id <id> --to <url|id> --type <type>
  pm task link list --id <id>
  pm task link rm   --id <id> --link <linkId>

  pm board --project <id|name>          # columns view: tasks grouped by status
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
  const tR = await api("GET", `/api/tasks?project=${pid}`);
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
    process.stdout.write(`pm ${VERSION}\n`);
    process.exit(0);
  }

  const [group, rawAction, ...rest] = R.argv;
  const action = ALIAS[rawAction] ?? rawAction;

  if (!group || group === "help" || group === "--help") {
    if (R.mode === "json") process.stdout.write(JSON.stringify({ help: HELP }, null, 2) + "\n");
    else process.stdout.write(HELP + "\n");
    process.exit(0);
  }

  // Single-word commands: flags live in [rawAction, ...rest].
  if (group === "login" || group === "whoami" || group === "board") {
    const sf = parseFlags([rawAction, ...rest].filter((x): x is string => !!x));
    if (group === "whoami") return emit("raw", await api("GET", "/api/auth/me"));
    if (group === "login")
      return emit(
        "raw",
        await api("POST", "/api/auth/login", {
          username: need(sf, "username"),
          password: need(sf, "password"),
        })
      );
    // board — Task 7 fills this in.
    return board(sf);
  }

  // `task link <add|list|rm>` has a sub-action positional, so it can't use the
  // flat `${group} ${action}` switch — handle it before flags are parsed.
  if (group === "task" && rawAction === "link") {
    const sub = ALIAS[rest[0]] ?? rest[0];
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
        return emit("raw", await api("GET", `/api/tasks/${need(lf, "id")}/links`));
      case "delete": // ALIAS maps `rm` → `delete`
        return emit(
          "ok",
          await api(
            "DELETE",
            `/api/tasks/${need(lf, "id")}/links/${need(lf, "link")}`
          )
        );
      default:
        fail(`unknown command "task link ${rest[0] ?? ""}"`, { help: HELP });
    }
  }

  const f = parseFlags(rest);

  switch (`${group} ${action}`) {
    case "user create":
      return emit(
        "raw",
        await api("POST", "/api/auth/register", {
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
    case "project list":
      return emit("projects", await api("GET", "/api/projects"));
    case "project update":
      return emit(
        "project",
        await api("PATCH", `/api/projects/${proj(f)}`, {
          name: typeof f.name === "string" ? f.name : undefined,
          description: typeof f.description === "string" ? f.description : undefined,
        })
      );
    case "project delete":
      return emit("ok", await api("DELETE", `/api/projects/${proj(f)}`));

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
        const titles = readFileSync(0, "utf8")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        const created: any[] = [];
        for (const title of titles) {
          const r = await api("POST", "/api/tasks", {
            project: need(f, "project"),
            title,
            status: typeof f.status === "string" ? f.status : undefined,
            assignee: typeof f.assignee === "string" ? f.assignee : undefined,
            priority: typeof f.priority === "string" ? f.priority : undefined,
          });
          if (!(r.status >= 200 && r.status < 300)) return emit("task", r); // surface first error
          created.push(r.json);
        }
        return emit("tasks", { status: 200, json: created });
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
    case "task list": {
      const qs = new URLSearchParams({ project: need(f, "project") });
      if (typeof f.status === "string") qs.set("status", f.status);
      if (f["include-deleted"]) qs.set("includeDeleted", "true");
      if (typeof f.assignee === "string") qs.set("assignee", f.assignee);
      if (typeof f.priority === "string") qs.set("priority", f.priority);
      return emit("tasks", await api("GET", `/api/tasks?${qs.toString()}`));
    }
    case "task move":
      return emit(
        "task",
        await api("PATCH", `/api/tasks/${need(f, "id")}`, {
          status: need(f, "status"),
          version: f.version !== undefined ? Number(f.version) : undefined,
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
          version: f.version !== undefined ? Number(f.version) : undefined,
          assignee,
          priority: typeof f.priority === "string" ? f.priority : undefined,
        })
      );
    }
    case "task delete":
      return emit("ok", await api("DELETE", `/api/tasks/${need(f, "id")}`));
    case "task restore":
      return emit("task", await api("POST", `/api/tasks/${need(f, "id")}/restore`));

    default:
      fail(`unknown command "${group} ${action}"`, { help: HELP });
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

if (isEntrypoint()) {
  main().catch((e) => fail(String(e?.message ?? e)));
}
