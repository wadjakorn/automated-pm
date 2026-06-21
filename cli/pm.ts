#!/usr/bin/env -S tsx
/**
 * pm — flag-based CLI for the Project Manager API.
 * Every command prints JSON to stdout. Exit 0 on success, non-zero on error.
 * All state-machine rules are enforced server-side, so the CLI inherits them.
 *
 * Base URL from PM_API (default http://localhost:3000).
 */

const BASE = process.env.PM_API ?? "http://localhost:3000";
// Optional auth: if PM_TOKEN is set, send it as a bearer token so created tasks
// are attributed to that user. Anonymous (no token) still works.
const TOKEN = process.env.PM_TOKEN;

type Flags = Record<string, string | boolean>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true; // boolean flag
    } else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

function out(data: unknown, code = 0): never {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  process.exit(code);
}

function fail(message: string, extra: Record<string, unknown> = {}): never {
  out({ error: "cli_error", message, ...extra }, 1);
}

async function api(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {};
  if (body) headers["content-type"] = "application/json";
  if (TOKEN) headers["authorization"] = `Bearer ${TOKEN}`;
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
}

// Unwrap an API response: success -> data, error -> exit non-zero with JSON.
function unwrap(r: { status: number; json: any }): never {
  if (r.status >= 200 && r.status < 300) out(r.json, 0);
  out(r.json ?? { error: "http_" + r.status }, 1);
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

  # --project accepts a project id OR its (unique) name, e.g. --project 'demo'
  pm status list --project <id|name>
  pm status add --project <id|name> --key <key> --label <label> [--final]
  pm status set-final --project <id|name> --key <key> --final <true|false>
  pm status remove --project <id|name> --key <key>

  pm transition add --project <id|name> --from <key> --to <key>
  pm transition remove --project <id|name> --from <key> --to <key>

  # --assignee accepts a user id OR username
  pm task create --project <id|name> --title <title> [--description <text>] [--status <key>] [--assignee <id|username>]
  pm task list --project <id|name> [--status <key>] [--include-deleted] [--assignee <id|username>]
  pm task move --id <id> --status <key> [--version <n>]
  pm task update --id <id> [--title <t>] [--description <text>] [--version <n>] [--assignee <id|username> | --unassign]
  pm task delete --id <id>
  pm task restore --id <id>
`;

async function main() {
  const [, , group, action, ...rest] = process.argv;

  if (!group || group === "help" || group === "--help") out({ help: HELP }, 0);

  // Single-word commands: `action` is actually the first flag, so parse flags
  // from [action, ...rest].
  if (group === "login" || group === "whoami") {
    const lf = parseFlags([action, ...rest].filter((x): x is string => !!x));
    if (group === "whoami") return unwrap(await api("GET", "/api/auth/me"));
    return unwrap(
      await api("POST", "/api/auth/login", {
        username: need(lf, "username"),
        password: need(lf, "password"),
      })
    );
  }

  const f = parseFlags(rest);

  switch (`${group} ${action}`) {
    case "user create":
      return unwrap(
        await api("POST", "/api/auth/register", {
          username: need(f, "username"),
          password: need(f, "password"),
        })
      );
    case "user list":
      return unwrap(await api("GET", "/api/users"));

    case "project create":
      return unwrap(
        await api("POST", "/api/projects", {
          name: need(f, "name"),
          description: f.description,
        })
      );
    case "project list":
      return unwrap(await api("GET", "/api/projects"));

    case "status list":
      return unwrap(await api("GET", `/api/projects/${proj(f)}/statuses`));
    case "status add":
      return unwrap(
        await api("POST", `/api/projects/${proj(f)}/statuses`, {
          key: need(f, "key"),
          label: f.label,
          is_final: !!f.final,
        })
      );
    case "status set-final":
      return unwrap(
        await api("PATCH", `/api/projects/${proj(f)}/statuses`, {
          key: need(f, "key"),
          is_final: f.final === "true" || f.final === true,
        })
      );
    case "status remove":
      return unwrap(
        await api(
          "DELETE",
          `/api/projects/${proj(f)}/statuses?key=${encodeURIComponent(need(f, "key"))}`
        )
      );

    case "transition add":
      return unwrap(
        await api("POST", `/api/projects/${proj(f)}/transitions`, {
          from: need(f, "from"),
          to: need(f, "to"),
        })
      );
    case "transition remove":
      return unwrap(
        await api(
          "DELETE",
          `/api/projects/${proj(f)}/transitions?from=${encodeURIComponent(
            need(f, "from")
          )}&to=${encodeURIComponent(need(f, "to"))}`
        )
      );

    case "task create":
      return unwrap(
        await api("POST", "/api/tasks", {
          project: need(f, "project"),
          title: need(f, "title"),
          description: f.description,
          status: f.status,
          assignee: typeof f.assignee === "string" ? f.assignee : undefined,
        })
      );
    case "task list": {
      const qs = new URLSearchParams({ project: need(f, "project") });
      if (typeof f.status === "string") qs.set("status", f.status);
      if (f["include-deleted"]) qs.set("includeDeleted", "true");
      if (typeof f.assignee === "string") qs.set("assignee", f.assignee);
      return unwrap(await api("GET", `/api/tasks?${qs.toString()}`));
    }
    case "task move":
      return unwrap(
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
      return unwrap(
        await api("PATCH", `/api/tasks/${need(f, "id")}`, {
          title: f.title,
          description: f.description,
          version: f.version !== undefined ? Number(f.version) : undefined,
          assignee,
        })
      );
    }
    case "task delete":
      return unwrap(await api("DELETE", `/api/tasks/${need(f, "id")}`));
    case "task restore":
      return unwrap(await api("POST", `/api/tasks/${need(f, "id")}/restore`));

    default:
      fail(`unknown command "${group} ${action}"`, { help: HELP });
  }
}

main().catch((e) => fail(String(e?.message ?? e)));
