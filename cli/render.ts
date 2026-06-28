import type { Mode } from "./mode";

export type Kind =
  | "projects" | "project" | "statemachine"
  | "tasks" | "task" | "board" | "ready" | "ok" | "raw";

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
    ["ID", "NAME", "REMOTE", "CREATED"],
    list.map((p) => [
      p.id,
      p.name,
      p.remote_repo_url ?? "",
      String(p.created_at ?? "").slice(0, 10),
    ])
  );
}

function renderProject(p: any, o: RenderOpts): string {
  const repo = p.remote_repo_url ? `  ${paint(p.remote_repo_url, ANSI.dim, o.color)}` : "";
  return `${paint("✓", ANSI.green, o.color)} project ${p.name} (${p.id})${repo}`;
}

function renderTasks(list: any[]): string {
  if (!list.length) return "(no tasks)";
  return table(
    ["ID", "STATUS", "PRIO", "TITLE", "VER"],
    list.map((t) => [t.id, t.status_key, t.priority ?? "", t.title, "v" + t.version])
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

function renderReady(list: any[]): string {
  if (!list.length) return "(no ready tickets)";
  return table(
    ["TICKET", "PROJECT", "PRIO", "REPO", "TITLE"],
    list.map((r) => [r.ticket, r.projectName ?? r.project, r.priority ?? "", r.repo ?? "", r.title ?? ""])
  );
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
    case "ready": return renderReady(data);
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
