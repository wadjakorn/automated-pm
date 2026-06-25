# CLI Enhance/Optimize + Web Light Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `pm` CLI human-friendly (TTY-aware pretty output) while staying script-safe, fill the CLI command gaps, realign the skill doc, and add a light/dark theme to the web UI.

**Architecture:** CLI gains two pure, unit-tested modules — `cli/mode.ts` (resolve output mode + global flags) and `cli/render.ts` (data → string renderers) — with `cli/pm.ts` reduced to wiring. The web UI moves color decisions into CSS variables (`:root` light / `.dark` dark), adds a `ThemeProvider` + anti-FOUC head script + a nav toggle, and sweeps hardcoded Tailwind color classes to semantic tokens.

**Tech Stack:** TypeScript, tsx, Next.js 15 (App Router), React 19, Tailwind (`darkMode: "class"`), vitest, better-sqlite3 (server, unchanged here).

## Global Constraints

- **No new runtime dependencies.** Tables/ANSI are hand-rolled. (spec: "no table/TUI libraries or new runtime deps".)
- **JSON output contract is frozen.** In `json` mode the payload is exactly the API JSON (success) or `{ error, message, ... }` (failure). Pretty formatting never changes the data, only its presentation. Existing `jq`/`sed` agent workflows must keep working unchanged.
- **Default mode is TTY-aware:** stdout is a TTY → `pretty`; piped/redirected → `json`. `--json` and `--pretty` are explicit overrides; `--json` wins over `--pretty`.
- **Color** only in `pretty` mode AND when neither `NO_COLOR` (env) nor `--no-color` is set. Tables are rendered **without** in-cell ANSI (avoids column-width miscalculation); color is used only in single-line confirmations, board headers, and error hints.
- **Exit codes stay binary:** 0 success, non-zero failure.
- **No server changes.** All backing API routes already exist (`PATCH`/`DELETE /api/projects/[id]`, `PATCH /api/projects/[id]/statuses` accepting `label`/`is_final`/`sort_order`).
- **Auth is out of scope** (already shipped). Do not modify auth code or the skill's auth sections.
- **Tests:** vitest, `npm test` (`vitest run`), config includes `**/*.test.ts` so `cli/*.test.ts` is picked up automatically.
- **Theme:** light is the `:root` default; `.dark` on `<html>` selects dark. Persisted choice is `localStorage.theme ∈ {light,dark,system}`; `system` follows `prefers-color-scheme` live. No FOUC.

---

## Task 1: Output-mode resolution (`cli/mode.ts`)

Pure function that strips global flags from argv and resolves output mode, color, api base, and version request.

**Files:**
- Create: `cli/mode.ts`
- Test: `cli/mode.test.ts`

**Interfaces:**
- Produces:
  - `type Mode = "json" | "pretty"`
  - `interface Resolved { mode: Mode; color: boolean; api: string; argv: string[]; showVersion: boolean }`
  - `function resolveGlobals(input: { argv: string[]; isTTY: boolean; env: Record<string, string | undefined> }): Resolved`

- [ ] **Step 1: Write the failing test**

```ts
// cli/mode.test.ts
import { describe, it, expect } from "vitest";
import { resolveGlobals } from "./mode";

const base = { isTTY: false, env: {} as Record<string, string | undefined> };

describe("resolveGlobals", () => {
  it("defaults to json when not a TTY", () => {
    const r = resolveGlobals({ ...base, argv: ["project", "list"] });
    expect(r.mode).toBe("json");
    expect(r.argv).toEqual(["project", "list"]);
  });

  it("defaults to pretty on a TTY", () => {
    const r = resolveGlobals({ ...base, isTTY: true, argv: ["project", "list"] });
    expect(r.mode).toBe("pretty");
  });

  it("--json overrides a TTY", () => {
    const r = resolveGlobals({ ...base, isTTY: true, argv: ["project", "list", "--json"] });
    expect(r.mode).toBe("json");
    expect(r.argv).toEqual(["project", "list"]);
  });

  it("--json beats --pretty", () => {
    const r = resolveGlobals({ ...base, argv: ["x", "--pretty", "--json"] });
    expect(r.mode).toBe("json");
  });

  it("color on only in pretty without NO_COLOR/--no-color", () => {
    expect(resolveGlobals({ ...base, isTTY: true, argv: ["x"] }).color).toBe(true);
    expect(resolveGlobals({ ...base, isTTY: true, argv: ["x", "--no-color"] }).color).toBe(false);
    expect(resolveGlobals({ isTTY: true, env: { NO_COLOR: "1" }, argv: ["x"] }).color).toBe(false);
    expect(resolveGlobals({ ...base, argv: ["x", "--pretty"] }).color).toBe(true);
  });

  it("--api consumes the next token; falls back to env then default", () => {
    expect(resolveGlobals({ ...base, argv: ["x", "--api", "http://h:9"] }).api).toBe("http://h:9");
    expect(resolveGlobals({ ...base, argv: ["x", "--api", "http://h:9"] }).argv).toEqual(["x"]);
    expect(resolveGlobals({ isTTY: false, env: { PM_API: "http://e:8" }, argv: ["x"] }).api).toBe("http://e:8");
    expect(resolveGlobals({ ...base, argv: ["x"] }).api).toBe("http://localhost:3000");
  });

  it("--version / -v set showVersion and are stripped", () => {
    expect(resolveGlobals({ ...base, argv: ["--version"] }).showVersion).toBe(true);
    expect(resolveGlobals({ ...base, argv: ["-v"] }).showVersion).toBe(true);
    expect(resolveGlobals({ ...base, argv: ["project", "-v", "list"] }).argv).toEqual(["project", "list"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/mode.test.ts`
Expected: FAIL — `Cannot find module './mode'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// cli/mode.ts
export type Mode = "json" | "pretty";

export interface Resolved {
  mode: Mode;
  color: boolean;
  api: string;
  argv: string[];      // argv with global flags removed
  showVersion: boolean;
}

// Pull global flags out of argv and resolve the output mode. Pure: all inputs
// (argv, TTY-ness, env) are injected so the resolver is unit-testable.
export function resolveGlobals(input: {
  argv: string[];
  isTTY: boolean;
  env: Record<string, string | undefined>;
}): Resolved {
  const { argv, isTTY, env } = input;
  let json = false;
  let pretty = false;
  let noColor = false;
  let showVersion = false;
  let api = env.PM_API ?? "http://localhost:3000";
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") json = true;
    else if (t === "--pretty") pretty = true;
    else if (t === "--no-color") noColor = true;
    else if (t === "--version" || t === "-v") showVersion = true;
    else if (t === "--api") {
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith("--")) {
        api = v;
        i++;
      }
    } else rest.push(t);
  }

  const mode: Mode = json ? "json" : pretty ? "pretty" : isTTY ? "pretty" : "json";
  const color = mode === "pretty" && !noColor && !env.NO_COLOR;
  return { mode, color, api, argv: rest, showVersion };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/mode.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/mode.ts cli/mode.test.ts
git commit -m "feat(cli): add output-mode + global-flag resolver"
```

---

## Task 2: Render layer — core shapes (`cli/render.ts`)

Pure renderers for the common result shapes plus the error renderer and the plain-text table helper.

**Files:**
- Create: `cli/render.ts`
- Test: `cli/render.test.ts`

**Interfaces:**
- Consumes: `Mode` from `cli/mode.ts`.
- Produces:
  - `type Kind = "projects" | "project" | "statemachine" | "tasks" | "task" | "board" | "ok" | "raw"`
  - `interface RenderOpts { mode: Mode; color: boolean }`
  - `function render(kind: Kind, data: any, o: RenderOpts): string`
  - `function renderError(data: any, o: RenderOpts): string`
  - `function table(headers: string[], rows: string[][]): string` (exported for tests)

- [ ] **Step 1: Write the failing test**

```ts
// cli/render.test.ts
import { describe, it, expect } from "vitest";
import { render, renderError, table } from "./render";

const pretty = { mode: "pretty" as const, color: false };
const json = { mode: "json" as const, color: false };

describe("table", () => {
  it("pads columns to the widest cell", () => {
    const out = table(["A", "BB"], [["xx", "y"], ["z", "wwww"]]);
    expect(out.split("\n")).toEqual(["A   BB", "xx  y", "z   wwww"]);
  });
});

describe("render json passthrough", () => {
  it("returns exact JSON regardless of kind", () => {
    const data = { a: 1 };
    expect(render("project", data, json)).toBe(JSON.stringify(data, null, 2));
  });
});

describe("render pretty", () => {
  it("projects → table with header", () => {
    const out = render("projects", [{ id: "p1", name: "Demo", description: null, created_at: "2026-01-02T00:00:00Z" }], pretty);
    expect(out).toContain("ID");
    expect(out).toContain("p1");
    expect(out).toContain("Demo");
    expect(out).toContain("2026-01-02");
  });

  it("empty projects → placeholder", () => {
    expect(render("projects", [], pretty)).toBe("(no projects)");
  });

  it("single project → confirmation", () => {
    expect(render("project", { id: "p1", name: "Demo" }, pretty)).toBe('✓ project Demo (p1)');
  });

  it("single task → arrow confirmation", () => {
    expect(render("task", { id: "t1", title: "Wire it", status_key: "doing", version: 3 }, pretty))
      .toBe('✓ t1 "Wire it" → doing (v3)');
  });

  it("tasks → table", () => {
    const out = render("tasks", [{ id: "t1", status_key: "todo", title: "Hi", version: 1 }], pretty);
    expect(out).toContain("STATUS");
    expect(out).toContain("t1");
    expect(out).toContain("todo");
    expect(out).toContain("v1");
  });

  it("ok → done line", () => {
    expect(render("ok", { ok: true }, pretty)).toBe("✓ done");
  });
});

describe("renderError", () => {
  it("json mode returns the raw error payload", () => {
    const e = { error: "not_found", message: "task not found" };
    expect(renderError(e, json)).toBe(JSON.stringify(e, null, 2));
  });

  it("pretty mode prints code + message + hint", () => {
    const out = renderError({ error: "illegal_transition", message: "no edge" }, pretty);
    expect(out).toContain("✗ illegal_transition: no edge");
    expect(out).toContain("pm status list");
  });

  it("conflict hint mentions version", () => {
    expect(renderError({ error: "conflict", message: "stale" }, pretty)).toContain("version");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/render.test.ts`
Expected: FAIL — `Cannot find module './render'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// cli/render.ts
import type { Mode } from "./mode";

export type Kind =
  | "projects" | "project" | "statemachine"
  | "tasks" | "task" | "board" | "ok" | "raw";

export interface RenderOpts {
  mode: Mode;
  color: boolean;
}

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function paint(s: string, code: string, on: boolean): string {
  return on ? code + s + ANSI.reset : s;
}

// Plain-text column table. No in-cell ANSI, so widths are exact.
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );
  const fmt = (cells: string[]) =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ").trimEnd();
  return [fmt(headers), ...rows.map(fmt)].join("\n");
}

const json = (d: unknown) => JSON.stringify(d, null, 2);

function renderProjects(list: any[]): string {
  if (!list.length) return "(no projects)";
  return table(
    ["ID", "NAME", "DESCRIPTION", "CREATED"],
    list.map((p) => [p.id, p.name, p.description ?? "", String(p.created_at ?? "").slice(0, 10)])
  );
}

function renderProject(p: any, o: RenderOpts): string {
  return `${paint("✓", ANSI.green, o.color)} project ${p.name} (${p.id})`;
}

function renderTasks(list: any[]): string {
  if (!list.length) return "(no tasks)";
  return table(
    ["ID", "STATUS", "TITLE", "VER"],
    list.map((t) => [t.id, t.status_key, t.title, "v" + t.version])
  );
}

function renderTask(t: any, o: RenderOpts): string {
  const tick = paint("✓", ANSI.green, o.color);
  const st = paint(t.status_key, ANSI.cyan, o.color);
  return `${tick} ${t.id} "${t.title}" → ${st} (v${t.version})`;
}

function renderStateMachine(sm: any): string {
  const statuses = table(
    ["KEY", "LABEL", "FINAL", "ORDER"],
    (sm.statuses ?? []).map((s: any) => [s.key, s.label, s.is_final ? "yes" : "", String(s.sort_order)])
  );
  const edges = (sm.transitions ?? []).length
    ? sm.transitions.map((t: any) => `  ${t.from_key} → ${t.to_key}`).join("\n")
    : "  (none)";
  return `${statuses}\n\nTransitions:\n${edges}`;
}

function renderBoard(b: any, o: RenderOpts): string {
  return (b.columns ?? [])
    .map((col: any) => {
      const head = paint(`${col.status.label} (${col.tasks.length})`, ANSI.bold, o.color);
      const items = col.tasks.length
        ? col.tasks.map((t: any) => `  • ${t.title}  ${paint(t.id, ANSI.dim, o.color)}`).join("\n")
        : "  (empty)";
      return `${head}\n${items}`;
    })
    .join("\n\n");
}

export function render(kind: Kind, data: any, o: RenderOpts): string {
  if (o.mode === "json") return json(data);
  switch (kind) {
    case "projects": return renderProjects(data);
    case "project": return renderProject(data, o);
    case "statemachine": return renderStateMachine(data);
    case "tasks": return renderTasks(data);
    case "task": return renderTask(data, o);
    case "board": return renderBoard(data, o);
    case "ok": return `${paint("✓", ANSI.green, o.color)} done`;
    default: return json(data);
  }
}

function errorHint(code: string): string {
  switch (code) {
    case "illegal_transition": return "Run `pm status list --project <p>` to see allowed moves.";
    case "conflict": return "Row changed elsewhere; re-read and retry with the new version.";
    case "not_found": return "Re-list to get a valid id.";
    case "cli_error": return "Is the server running? Start it with `npm run dev`.";
    default: return "";
  }
}

export function renderError(data: any, o: RenderOpts): string {
  if (o.mode === "json") return json(data);
  const code = data?.error ?? "error";
  const msg = data?.message ?? "";
  const line = `${paint("✗", ANSI.red, o.color)} ${code}: ${msg}`;
  const hint = errorHint(code);
  return hint ? `${line}\n  ${paint(hint, ANSI.dim, o.color)}` : line;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/render.test.ts`
Expected: PASS.

> Note: `cli_error` always shows the "server running?" hint. Task 9 keeps this generic hint for any `cli_error`; network detection just ensures the message is descriptive.

- [ ] **Step 5: Commit**

```bash
git add cli/render.ts cli/render.test.ts
git commit -m "feat(cli): add pure render layer (tables, confirmations, errors)"
```

---

## Task 3: Board column rendering test coverage

`renderBoard` already exists from Task 2; add its dedicated test so the board shape is locked before the command wires it (Task 7).

**Files:**
- Modify: `cli/render.test.ts`

**Interfaces:**
- Consumes: `render("board", { columns: [{ status, tasks }] }, opts)` from Task 2.

- [ ] **Step 1: Add the failing test**

```ts
// append to cli/render.test.ts
describe("render board", () => {
  it("renders one block per column with task bullets", () => {
    const data = {
      columns: [
        { status: { key: "todo", label: "To Do" }, tasks: [{ id: "t1", title: "A" }] },
        { status: { key: "doing", label: "Doing" }, tasks: [] },
      ],
    };
    const out = render("board", data, pretty);
    expect(out).toContain("To Do (1)");
    expect(out).toContain("• A");
    expect(out).toContain("t1");
    expect(out).toContain("Doing (0)");
    expect(out).toContain("(empty)");
  });
});
```

- [ ] **Step 2: Run to verify it passes immediately** (implementation already present)

Run: `npx vitest run cli/render.test.ts`
Expected: PASS (board test green; if it fails, fix `renderBoard` to match).

- [ ] **Step 3: Commit**

```bash
git add cli/render.test.ts
git commit -m "test(cli): lock board column rendering shape"
```

---

## Task 4: Wire `pm.ts` to mode + render (no behavior change in json mode)

Replace direct JSON printing with `emit()`/`renderError()`, resolve globals once, add `--version`, route `--api` through `BASE`, and tag every existing handler with its `Kind`. JSON-mode output for existing commands must be byte-for-byte the same payload as before (still pretty-printed JSON).

**Files:**
- Modify: `cli/pm.ts` (full rewrite of the plumbing; command bodies keep their API calls)

**Interfaces:**
- Consumes: `resolveGlobals` (Task 1), `render`, `renderError`, `Kind` (Task 2).
- Produces: `emit(kind: Kind, r: { status: number; json: any }): never` used by all later command tasks.

- [ ] **Step 1: Rewrite the plumbing block at the top of `cli/pm.ts`**

Replace lines 1–69 (the header comment, `BASE`/`TOKEN`, `parseFlags`, `out`, `fail`, `api`, `unwrap`) with:

```ts
#!/usr/bin/env -S tsx
/**
 * pm — flag-based CLI for the Project Manager API.
 * Output is TTY-aware: a terminal gets pretty tables, a pipe gets JSON.
 * `--json`/`--pretty` force a mode; `--no-color` / NO_COLOR disable color.
 * Exit 0 on success, non-zero on error. All rules are enforced server-side.
 *
 * Base URL: --api <url>, else PM_API, else http://localhost:3000.
 */
import { readFileSync } from "node:fs";
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

const proj = (f: Flags): string => encodeURIComponent(need(f, "project"));
```

- [ ] **Step 2: Replace `main()`'s preamble and dispatch wiring**

Replace the `async function main()` opening (the `const [, , group, action, ...rest]` line through the `const f = parseFlags(rest)` line, i.e. current lines 110–128) with:

```ts
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();

const ALIAS: Record<string, string> = { ls: "list", mv: "move", rm: "delete" };

async function main() {
  if (R.showVersion) {
    process.stdout.write(`pm ${VERSION}\n`);
    process.exit(0);
  }

  const [group, rawAction, ...rest] = R.argv;
  const action = ALIAS[rawAction] ?? rawAction;

  if (!group || group === "help") {
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

  const f = parseFlags(rest);

  switch (`${group} ${action}`) {
```

- [ ] **Step 3: Convert every existing `unwrap(...)` call to `emit(kind, ...)`**

Apply this kind mapping (replace `unwrap(` with `emit("<kind>", ` and keep the same `await api(...)` argument, closing the extra paren):

| Command | Kind |
|---|---|
| `user create`, `user list`, `whoami`, `login` | `raw` |
| `project create`, `project list` | `project`, `projects` |
| `status list/add/set-final/remove`, `transition add/remove` | `statemachine` |
| `task create` (single), `task move`, `task update`, `task restore` | `task` |
| `task list` | `tasks` |
| `task delete` | `ok` |

Example — `project list` becomes:
```ts
    case "project list":
      return emit("projects", await api("GET", "/api/projects"));
```
Example — `task delete` becomes:
```ts
    case "task delete":
      return emit("ok", await api("DELETE", `/api/tasks/${need(f, "id")}`));
```

Leave the `default:` branch as `fail(...)`. Keep the bottom `main().catch((e) => fail(String(e?.message ?? e)));`.

- [ ] **Step 4: Add a temporary no-op `board` stub so the file compiles** (Task 7 replaces it)

Add above `main()`:
```ts
async function board(_f: Flags): Promise<never> {
  return fail("board not implemented yet");
}
```

- [ ] **Step 5: Verify json-mode parity + pretty rendering manually**

Start the dev server in another shell (`npm run dev`), then:
```bash
# piped → JSON (unchanged contract)
npx tsx cli/pm.ts project list | head -1
# Expected: a "[" or "{" — valid JSON, parseable by jq.

# forced pretty over a pipe → table header
npx tsx cli/pm.ts project list --pretty | head -1
# Expected: a line containing "ID   NAME ..." (or "(no projects)").

# version
npx tsx cli/pm.ts --version
# Expected: pm 0.1.0
```
Expected: piped output parses as JSON; `--pretty` shows a table/placeholder; version prints.

- [ ] **Step 6: Run the unit suite (no regressions)**

Run: `npm test`
Expected: PASS (existing 25 + Task 1/2/3 tests).

- [ ] **Step 7: Commit**

```bash
git add cli/pm.ts
git commit -m "feat(cli): TTY-aware output via mode+render, add --version/--api"
```

---

## Task 5: New commands — `pm project update` / `pm project delete`

**Files:**
- Modify: `cli/pm.ts` (add two `case`s + help text)

**Interfaces:**
- Consumes: `emit`, `api`, `proj`, `need` (Task 4). Routes: `PATCH /api/projects/[id]`, `DELETE /api/projects/[id]` (exist).

- [ ] **Step 1: Add the cases** (after the `project list` case)

```ts
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
```

- [ ] **Step 2: Add to `HELP`** (under the project section)

```
  pm project update --project <id|name> [--name <new>] [--description <text>]
  pm project delete --project <id|name>
```

- [ ] **Step 3: Verify against the dev server**

```bash
PID=$(npx tsx cli/pm.ts project create --name "plan-verify" --json | sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' | head -1)
npx tsx cli/pm.ts project update --project "$PID" --description "edited" --json
npx tsx cli/pm.ts project delete --project "$PID" --json
```
Expected: update returns the project JSON with `"description": "edited"`; delete returns `{"ok":true}`.

- [ ] **Step 4: Commit**

```bash
git add cli/pm.ts
git commit -m "feat(cli): add project update/delete commands"
```

---

## Task 6: Generalize `pm status update` (keep `set-final`)

**Files:**
- Modify: `cli/pm.ts` (add `status update` case + help; leave `status set-final` intact)

**Interfaces:**
- Consumes: `emit`, `api`, `proj`, `need`. Route: `PATCH /api/projects/[id]/statuses` accepts `{ key, label?, is_final?, sort_order? }` (exists).

- [ ] **Step 1: Add the case** (next to `status set-final`)

```ts
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
```

- [ ] **Step 2: Add to `HELP`**

```
  pm status update --project <id|name> --key <key> [--label <l>] [--final <true|false>] [--order <n>]
```

- [ ] **Step 3: Verify**

```bash
PID=$(npx tsx cli/pm.ts project create --name "status-verify" --json | sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' | head -1)
npx tsx cli/pm.ts status update --project "$PID" --key todo --label "To-Do!" --json
npx tsx cli/pm.ts project delete --project "$PID" --json
```
Expected: the `todo` status comes back with `"label": "To-Do!"`.

- [ ] **Step 4: Commit**

```bash
git add cli/pm.ts
git commit -m "feat(cli): generalize status update (label/final/order)"
```

---

## Task 7: `pm board` command

Compose the state machine + live tasks into ordered columns, emit kind `board`.

**Files:**
- Modify: `cli/pm.ts` (replace the `board` stub from Task 4)

**Interfaces:**
- Consumes: `emit`, `api`, `need`, `parseFlags`. Produces JSON shape `{ project, columns: [{ status, tasks }] }` consumed by `renderBoard` (Task 2/3).

- [ ] **Step 1: Replace the `board` stub**

```ts
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
```

- [ ] **Step 2: Add to `HELP`**

```
  pm board --project <id|name>          # columns view: tasks grouped by status
```

- [ ] **Step 3: Verify (pretty + json)**

```bash
PID=$(npx tsx cli/pm.ts project create --name "board-verify" --json | sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' | head -1)
npx tsx cli/pm.ts task create --project "$PID" --title "first" --json >/dev/null
npx tsx cli/pm.ts board --project "$PID" --pretty
npx tsx cli/pm.ts board --project "$PID" --json | head -1
npx tsx cli/pm.ts project delete --project "$PID" --json
```
Expected: pretty shows status blocks with the task under the first column; json starts with `{` and contains `"columns"`.

- [ ] **Step 4: Commit**

```bash
git add cli/pm.ts
git commit -m "feat(cli): add board command (columns by status)"
```

---

## Task 8: Aliases + `--stdin` bulk task create

Aliases (`ls`/`mv`/`rm`) are already wired via the `ALIAS` map in Task 4; this task adds the `--stdin` bulk path and a test for the alias map, then documents both.

**Files:**
- Modify: `cli/pm.ts` (`task create` case + help)
- Create: `cli/alias.test.ts`

**Interfaces:**
- Consumes: `readFileSync(0, ...)` for stdin; `emit("tasks", ...)` for the batch result.

- [ ] **Step 1: Write a failing test for the alias map**

Extract the alias map to an exported const so it is testable. In `cli/pm.ts`, ensure the map is exported:
```ts
export const ALIAS: Record<string, string> = { ls: "list", mv: "move", rm: "delete" };
```
Then:
```ts
// cli/alias.test.ts
import { describe, it, expect } from "vitest";
import { ALIAS } from "./pm";

describe("action aliases", () => {
  it("maps ls/mv/rm to canonical actions", () => {
    expect(ALIAS.ls).toBe("list");
    expect(ALIAS.mv).toBe("move");
    expect(ALIAS.rm).toBe("delete");
  });
});
```

> Importing `cli/pm.ts` runs its top level. Guard execution so importing it as a module does not fire `main()`: wrap the bottom call as
> ```ts
> if (import.meta.url === `file://${process.argv[1]}`) {
>   main().catch((e) => fail(String(e?.message ?? e)));
> }
> ```
> Apply this change in this step.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run cli/alias.test.ts`
Expected: FAIL — `ALIAS` not exported (or module executes `main`). Fix per Step 1 guard + export.

- [ ] **Step 3: Add the `--stdin` bulk branch to `task create`**

Replace the `task create` case with:
```ts
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
        })
      );
    }
```

- [ ] **Step 4: Add help text**

```
  pm task create --project <id|name> --stdin   # one task per non-empty stdin line
  # aliases: `ls`=list, `mv`=move, `rm`=delete (e.g. pm task ls --project demo)
```

- [ ] **Step 5: Run tests + verify bulk**

```bash
npx vitest run cli/alias.test.ts
PID=$(npx tsx cli/pm.ts project create --name "bulk-verify" --json | sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' | head -1)
printf 'task one\ntask two\n\n' | npx tsx cli/pm.ts task create --project "$PID" --stdin --json
npx tsx cli/pm.ts task ls --project "$PID" --json | sed -n 's/.*"title": *"\([^"]*\)".*/\1/p'
npx tsx cli/pm.ts project delete --project "$PID" --json
```
Expected: alias test passes; bulk returns a 2-element array; `task ls` (alias) lists both titles.

- [ ] **Step 6: Commit**

```bash
git add cli/pm.ts cli/alias.test.ts
git commit -m "feat(cli): stdin bulk task create + ls/mv/rm aliases"
```

---

## Task 9: Error hint polish + full suite gate

`renderError` hints and the `api()` network-catch already exist (Tasks 2 & 4). This task verifies the down-server path end-to-end and runs the whole suite.

**Files:**
- Modify: `cli/render.test.ts` (add cli_error hint test)

**Interfaces:**
- Consumes: `renderError` (Task 2).

- [ ] **Step 1: Add the failing test**

```ts
// append to cli/render.test.ts
describe("renderError cli_error", () => {
  it("hints to start the server", () => {
    const out = renderError({ error: "cli_error", message: "Cannot reach http://x" }, pretty);
    expect(out).toContain("✗ cli_error");
    expect(out).toContain("npm run dev");
  });
});
```

- [ ] **Step 2: Run to verify** (implementation already present from Task 2)

Run: `npx vitest run cli/render.test.ts`
Expected: PASS.

- [ ] **Step 3: Verify the live down-server path**

With **no** dev server running (or point at a dead port):
```bash
npx tsx cli/pm.ts project list --api http://localhost:59999 --pretty
```
Expected: `✗ cli_error: Cannot reach http://localhost:59999: ...` followed by the `npm run dev` hint; exit code non-zero (`echo $?` → 1).

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: PASS (all CLI + lib tests).

- [ ] **Step 5: Commit**

```bash
git add cli/render.test.ts
git commit -m "test(cli): cover cli_error hint; verify down-server path"
```

---

## Task 10: Skill doc realignment (additive)

Document the new output contract + commands. **Leave the auth sections untouched** (they are accurate).

**Files:**
- Modify: `~/.claude/skills/project-manager-cli/SKILL.md`

- [ ] **Step 1: Update §1 (Output & error contract)**

Add after the existing bullet list:
```markdown
- **Output is TTY-aware.** A pipe/redirect (non-TTY) prints **JSON** — so the
  `jq`/`sed` recipes below are unchanged. An interactive terminal prints pretty
  tables/board. Force a mode with `--json` (always JSON, even on a TTY) or
  `--pretty`; disable color with `--no-color` or `NO_COLOR`. Agents should pass
  `--json` when they need to be certain, though piped output is already JSON.
- **Global flags:** `--api <url>` (overrides `PM_API`), `--version`, plus the
  output flags above. They may appear in any position.
```

- [ ] **Step 2: Add new commands to §2 (Command reference)**

```markdown
pm board   --project <id|name>            # columns view: tasks grouped by status

pm project update --project <id|name> [--name <new>] [--description <text>]
pm project delete --project <id|name>     # soft delete (recoverable via the UI/Trash)

pm status update --project <id|name> --key <key> [--label <l>] [--final <true|false>] [--order <n>]
#   generalizes `status set-final`; `set-final` still works.

pm task create --project <id|name> --stdin   # one task per non-empty stdin line
# Action aliases: ls=list, mv=move, rm=delete  (e.g. `pm task ls --project demo`)
```

- [ ] **Step 3: Add an alias note to §6 (Pitfalls)**

```markdown
- **Pretty vs JSON.** If you script `pm` and parse stdout, you already get JSON
  (non-TTY). Only humans in a terminal see tables. Never parse pretty output —
  pass `--json` if unsure.
```

- [ ] **Step 4: Verify the skill's §7 block still passes** against a running server (commands are additive; JSON mode unchanged). Run the §7 snippet; confirm pass criteria still hold.

- [ ] **Step 5: Commit** (skill lives outside the repo; commit only if it is under version control — otherwise note the edit is saved in place)

```bash
# if ~/.claude is a git repo:
# git -C ~/.claude add skills/project-manager-cli/SKILL.md && git -C ~/.claude commit -m "docs(skill): document pm output modes + new commands"
echo "Skill updated in place at ~/.claude/skills/project-manager-cli/SKILL.md"
```

---

## Task 11: Theme token layer (`globals.css` + `tailwind.config.ts`)

Move colors into CSS variables; light is `:root`, dark is `.dark`. Add text/accent tokens.

**Files:**
- Modify: `app/globals.css`
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Rewrite `app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Light (default) */
:root {
  color-scheme: light;
  --bg: #ffffff;
  --bg-soft: #f6f8fa;
  --bg-card: #ffffff;
  --border: #d0d7de;
  --fg: #1f2328;
  --fg-muted: #57606a;
  --fg-subtle: #8c959f;
  --accent: #0969da;
  --accent-hover: #0860ca;
  --scrollbar: #d0d7de;
}

/* Dark */
.dark {
  color-scheme: dark;
  --bg: #0d1117;
  --bg-soft: #161b22;
  --bg-card: #1c2128;
  --border: #30363d;
  --fg: #e6edf3;
  --fg-muted: #9aa4af;
  --fg-subtle: #6e7681;
  --accent: #2563eb;
  --accent-hover: #3b82f6;
  --scrollbar: #30363d;
}

html,
body {
  height: 100%;
}

body {
  @apply bg-bg text-fg antialiased;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-thumb {
  background: var(--scrollbar);
  border-radius: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
```

- [ ] **Step 2: Rewrite `tailwind.config.ts` color tokens to reference the variables**

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "var(--bg)",
          soft: "var(--bg-soft)",
          card: "var(--bg-card)",
        },
        border: { DEFAULT: "var(--border)" },
        fg: {
          DEFAULT: "var(--fg)",
          muted: "var(--fg-muted)",
          subtle: "var(--fg-subtle)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 3: Build sanity check**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors from the config/CSS change).

- [ ] **Step 4: Commit**

```bash
git add app/globals.css tailwind.config.ts
git commit -m "feat(ui): variable-backed theme tokens (light default + dark)"
```

---

## Task 12: Theme-resolution helper (`components/theme.ts`)

Pure logic for resolving the effective theme, unit-tested.

**Files:**
- Create: `components/theme.ts`
- Test: `components/theme.test.ts`

**Interfaces:**
- Produces:
  - `type ThemeChoice = "light" | "dark" | "system"`
  - `function resolveTheme(choice: ThemeChoice, prefersDark: boolean): "light" | "dark"`
  - `function nextChoice(current: ThemeChoice): ThemeChoice` (toggle cycle)

- [ ] **Step 1: Write the failing test**

```ts
// components/theme.test.ts
import { describe, it, expect } from "vitest";
import { resolveTheme, nextChoice } from "./theme";

describe("resolveTheme", () => {
  it("explicit choices win", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("system follows prefersDark", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("nextChoice", () => {
  it("cycles light → dark → system → light", () => {
    expect(nextChoice("light")).toBe("dark");
    expect(nextChoice("dark")).toBe("system");
    expect(nextChoice("system")).toBe("light");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run components/theme.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// components/theme.ts
export type ThemeChoice = "light" | "dark" | "system";

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): "light" | "dark" {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

export function nextChoice(current: ThemeChoice): ThemeChoice {
  return current === "light" ? "dark" : current === "dark" ? "system" : "light";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run components/theme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/theme.ts components/theme.test.ts
git commit -m "feat(ui): pure theme-resolution helpers"
```

---

## Task 13: ThemeProvider + anti-FOUC + layout wiring

**Files:**
- Create: `components/ThemeProvider.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `resolveTheme`, `ThemeChoice` (Task 12).
- Produces: `useTheme(): { choice: ThemeChoice; setChoice: (c: ThemeChoice) => void; resolved: "light" | "dark" }` (consumed by Task 14).

- [ ] **Step 1: Create `components/ThemeProvider.tsx`**

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { resolveTheme, type ThemeChoice } from "./theme";

interface Ctx {
  choice: ThemeChoice;
  setChoice: (c: ThemeChoice) => void;
  resolved: "light" | "dark";
}
const ThemeCtx = createContext<Ctx | null>(null);
const KEY = "theme";

function apply(resolved: "light" | "dark") {
  const el = document.documentElement;
  el.classList.toggle("dark", resolved === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("dark");

  // On mount, read the stored choice and sync to the DOM/media query.
  useEffect(() => {
    const stored = (typeof localStorage !== "undefined" && localStorage.getItem(KEY)) as ThemeChoice | null;
    const c: ThemeChoice = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    setChoiceState(c);
  }, []);

  // Re-resolve whenever the choice changes, and follow the OS when on "system".
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const recompute = () => {
      const r = resolveTheme(choice, mql.matches);
      setResolved(r);
      apply(r);
    };
    recompute();
    if (choice === "system") {
      mql.addEventListener("change", recompute);
      return () => mql.removeEventListener("change", recompute);
    }
  }, [choice]);

  const setChoice = (c: ThemeChoice) => {
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* ignore (private mode) */
    }
    setChoiceState(c);
  };

  return <ThemeCtx.Provider value={{ choice, setChoice, resolved }}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error("useTheme must be used within ThemeProvider");
  return c;
}
```

- [ ] **Step 2: Rewrite `app/layout.tsx`** — drop hardcoded `dark`, add the pre-paint script + provider

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Project Manager",
  description: "Kanban board with a state machine and an LLM-friendly CLI",
};

// Runs before first paint to set .dark from storage/OS — prevents a theme flash.
const NO_FLASH = `(function(){try{var c=localStorage.getItem('theme');var d=c==='dark'||((!c||c==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Type + build check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ThemeProvider.tsx app/layout.tsx
git commit -m "feat(ui): ThemeProvider + anti-FOUC head script, theme-aware html"
```

---

## Task 14: Nav theme toggle

**Files:**
- Modify: `components/Nav.tsx`

**Interfaces:**
- Consumes: `useTheme` (Task 13).

- [ ] **Step 1: Import the hook** — add near the other imports in `components/Nav.tsx`

```tsx
import { useTheme } from "./ThemeProvider";
import { nextChoice } from "./theme";
```

- [ ] **Step 2: Read theme in the component body** — after `const { user, refresh } = useAuth();`

```tsx
  const { choice, setChoice, resolved } = useTheme();
  const themeIcon = resolved === "dark" ? "🌙" : "☀️";
  const themeLabel = `Theme: ${choice}`;
```

- [ ] **Step 3: Add the toggle button** in the right-hand `<nav>`, before the auth divider (`<span className="mx-1 h-5 w-px bg-border" />`)

```tsx
        <button
          onClick={() => setChoice(nextChoice(choice))}
          title={themeLabel}
          aria-label={themeLabel}
          className="rounded px-2 py-1.5 text-sm text-fg-muted hover:text-fg"
        >
          {themeIcon}
        </button>
```

- [ ] **Step 4: Verify in the preview** (dev server)

Start `npm run dev`; load the app; click the toggle. Expected: clicking cycles light → dark → system; surfaces + text + accent flip; reload preserves the choice.

- [ ] **Step 5: Commit**

```bash
git add components/Nav.tsx
git commit -m "feat(ui): nav theme toggle (light/dark/system)"
```

---

## Task 15: Component color sweep → semantic tokens

Replace hardcoded color classes so both themes render correctly. This is a mechanical, exhaustive find-and-replace across the listed files.

**Files (modify):**
`components/{Nav,Board,TaskCard,EditDrawer,Settings,Trash,Toast,AuthForm}.tsx`,
`app/{page,login/page,register/page,settings/page,trash/page}.tsx`

**Mapping (apply everywhere):**

| Hardcoded class | Replace with |
|---|---|
| `text-white`, `text-gray-100`, `text-gray-200` | `text-fg` |
| `text-gray-300`, `text-gray-400` | `text-fg-muted` |
| `text-gray-500`, `text-gray-600`, `text-gray-700` | `text-fg-subtle` |
| `hover:text-white`, `hover:text-gray-200` | `hover:text-fg` |
| `bg-blue-600` | `bg-accent` |
| `hover:bg-blue-500` | `hover:bg-accent-hover` |
| `text-blue-400` | `text-accent` |
| `ring-blue-600` | `ring-accent` |
| `hover:border-gray-500`, `border-gray-500` | `hover:border-fg-subtle` / `border-fg-subtle` |

Leave alone (already tokenized or intentionally semantic): `bg-bg`, `bg-bg-soft`, `bg-bg-card`, `border-border`, and the red/green state colors used by Trash/badges (`*-red-*`, `*-green-*`, `bg-black`, `*-amber-*`) — those read acceptably in both themes; revisit only if a screenshot shows a problem.

- [ ] **Step 1: Find every occurrence**

Run:
```bash
grep -rn -E "(text-white|text-gray-[1-7]00|hover:text-white|hover:text-gray-200|bg-blue-600|hover:bg-blue-500|text-blue-400|ring-blue-600|border-gray-500)" components app
```
Expected: a list of sites covering the files above. Use it as the worklist.

- [ ] **Step 2: Apply the mapping — worked example `components/TaskCard.tsx`**

- `hover:border-gray-500` → `hover:border-fg-subtle`
- `text-gray-100` → `text-fg`
- `text-gray-400` (both) → `text-fg-muted`
- `bg-blue-600 ... text-white` (avatar) → `bg-accent ... text-fg` *(keep avatar text readable; if low-contrast on the accent, use `text-white` deliberately — accent is dark in both themes, so `text-white` is acceptable here; leave as `text-white`)*

Resulting class strings:
```
className={`cursor-grab rounded-md border border-border bg-bg-card p-3 text-sm shadow-sm active:cursor-grabbing ${
  isDragging && !overlay ? "opacity-30" : ""
} ${overlay ? "rotate-2 shadow-xl" : "hover:border-fg-subtle"}`}
...
<div className="font-medium text-fg">{task.title}</div>
...
<div className="mt-1 line-clamp-2 text-xs text-fg-muted">
...
<div className="mt-2 flex items-center gap-1 text-[11px] text-fg-muted">
  <span className="grid h-4 w-4 place-items-center rounded-full bg-accent text-[9px] font-semibold uppercase text-white">
```

- [ ] **Step 3: Apply the mapping — worked example `components/Nav.tsx`**

- `bg-bg-card text-white` (active link) → `bg-bg-card text-fg`
- `text-gray-400 hover:text-gray-200` (inactive link, login link, logout) → `text-fg-muted hover:text-fg`
- `text-white` (logo) → `text-fg`
- `text-gray-200` (select) → `text-fg`
- `bg-blue-600 ... hover:bg-blue-500` (Add) → `bg-accent ... hover:bg-accent-hover`
- `text-gray-300` (cancel, register, username) → `text-fg-muted`

- [ ] **Step 4: Sweep the remaining files** per the mapping (use the Step 1 grep output; repeat until it returns nothing for the mapped classes).

Run again to confirm zero remaining mapped classes:
```bash
grep -rn -E "(text-white|text-gray-[1-7]00|hover:text-gray-200|bg-blue-600|hover:bg-blue-500|text-blue-400|ring-blue-600|border-gray-500)" components app
```
Expected: only intentional `text-white`-on-accent avatars remain (TaskCard, and any avatar in Settings/EditDrawer) — everything else mapped.

- [ ] **Step 5: Type + build check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components app
git commit -m "feat(ui): sweep hardcoded colors to semantic theme tokens"
```

---

## Task 16: Preview verification + screenshots

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server** (`npm run dev`) and ensure it serves on `http://localhost:3000`.

- [ ] **Step 2: Light theme** — set theme to light via the toggle; verify: board, settings, trash, login, register all render with light surfaces, readable `text-fg`/`text-fg-muted`, accent buttons visible. No element is invisible (white-on-white / gray-on-white).

- [ ] **Step 3: Dark theme** — toggle to dark; verify parity with the original look (GitHub-dark-like).

- [ ] **Step 4: Persistence + no-FOUC** — reload in each theme; confirm the choice sticks and there is **no** flash of the wrong theme on load.

- [ ] **Step 5: System mode** — set choice to system; flip OS appearance; confirm the app follows live.

- [ ] **Step 6: Capture proof** — screenshot board + settings in both themes; attach to the PR/summary.

- [ ] **Step 7: Final full suite**

Run: `npm test`
Expected: PASS (lib + all CLI + theme-helper tests).

- [ ] **Step 8: Commit any verification notes** (if a doc is updated); otherwise no commit.

---

## Self-Review (completed during planning)

- **Spec coverage:** TTY output (T1,T2,T4) ✓; pretty renderers incl. board (T2,T3) ✓; `project update/delete` (T5) ✓; generalized `status update` (T6) ✓; `board` (T7) ✓; aliases + `--stdin` (T8) ✓; error hints + down-server (T2,T4,T9) ✓; `--api`/`--version`/`--no-color` (T1,T4) ✓; skill realignment, auth left intact (T10) ✓; token layer (T11) ✓; theme helper (T12) ✓; provider + anti-FOUC (T13) ✓; toggle (T14) ✓; component sweep incl. AuthForm/login/register (T15) ✓; verify + screenshots (T16) ✓. No server changes (constraint) ✓.
- **Placeholder scan:** none — every code step carries full code; the `board` stub (T4) is explicitly replaced in T7.
- **Type consistency:** `Resolved`/`Mode` (T1) consumed by `RenderOpts` (T2) and `R` (T4); `Kind` union (T2) matches every `emit("…")` tag in T4–T8; `ThemeChoice`/`resolveTheme`/`nextChoice` (T12) consumed by T13/T14; `useTheme` shape (T13) consumed by T14.
