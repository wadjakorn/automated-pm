#!/usr/bin/env -S tsx
/**
 * pm — flag-based CLI for the Project Manager API.
 * Every command prints JSON to stdout. Exit 0 on success, non-zero on error.
 * All state-machine rules are enforced server-side, so the CLI inherits them.
 *
 * Base URL from PM_API (default http://localhost:3000).
 */

const BASE = process.env.PM_API ?? "http://localhost:3000";

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
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
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

const HELP = `pm — Project Manager CLI

  pm project create --name <name> [--description <text>]
  pm project list

  pm status list --project <id>
  pm status add --project <id> --key <key> --label <label> [--final]
  pm status set-final --project <id> --key <key> --final <true|false>
  pm status remove --project <id> --key <key>

  pm transition add --project <id> --from <key> --to <key>
  pm transition remove --project <id> --from <key> --to <key>

  pm task create --project <id> --title <title> [--description <text>] [--status <key>]
  pm task list --project <id> [--status <key>] [--include-deleted]
  pm task move --id <id> --status <key> [--version <n>]
  pm task update --id <id> [--title <t>] [--description <text>] [--version <n>]
  pm task delete --id <id>
  pm task restore --id <id>
`;

async function main() {
  const [, , group, action, ...rest] = process.argv;
  const f = parseFlags(rest);

  if (!group || group === "help" || group === "--help") out({ help: HELP }, 0);

  switch (`${group} ${action}`) {
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
      return unwrap(await api("GET", `/api/projects/${need(f, "project")}/statuses`));
    case "status add":
      return unwrap(
        await api("POST", `/api/projects/${need(f, "project")}/statuses`, {
          key: need(f, "key"),
          label: f.label,
          is_final: !!f.final,
        })
      );
    case "status set-final":
      return unwrap(
        await api("PATCH", `/api/projects/${need(f, "project")}/statuses`, {
          key: need(f, "key"),
          is_final: f.final === "true" || f.final === true,
        })
      );
    case "status remove":
      return unwrap(
        await api(
          "DELETE",
          `/api/projects/${need(f, "project")}/statuses?key=${encodeURIComponent(need(f, "key"))}`
        )
      );

    case "transition add":
      return unwrap(
        await api("POST", `/api/projects/${need(f, "project")}/transitions`, {
          from: need(f, "from"),
          to: need(f, "to"),
        })
      );
    case "transition remove":
      return unwrap(
        await api(
          "DELETE",
          `/api/projects/${need(f, "project")}/transitions?from=${encodeURIComponent(
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
        })
      );
    case "task list": {
      const qs = new URLSearchParams({ project: need(f, "project") });
      if (typeof f.status === "string") qs.set("status", f.status);
      if (f["include-deleted"]) qs.set("includeDeleted", "true");
      return unwrap(await api("GET", `/api/tasks?${qs.toString()}`));
    }
    case "task move":
      return unwrap(
        await api("PATCH", `/api/tasks/${need(f, "id")}`, {
          status: need(f, "status"),
          version: f.version !== undefined ? Number(f.version) : undefined,
        })
      );
    case "task update":
      return unwrap(
        await api("PATCH", `/api/tasks/${need(f, "id")}`, {
          title: f.title,
          description: f.description,
          version: f.version !== undefined ? Number(f.version) : undefined,
        })
      );
    case "task delete":
      return unwrap(await api("DELETE", `/api/tasks/${need(f, "id")}`));
    case "task restore":
      return unwrap(await api("POST", `/api/tasks/${need(f, "id")}/restore`));

    default:
      fail(`unknown command "${group} ${action}"`, { help: HELP });
  }
}

main().catch((e) => fail(String(e?.message ?? e)));
