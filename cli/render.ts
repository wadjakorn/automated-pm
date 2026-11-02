import type { Mode } from "./mode";

export type Kind =
  | "projects" | "project" | "statemachine"
  | "tasks" | "task" | "taskdetail" | "board" | "ready" | "activity" | "inbox" | "search" | "overview" | "ok" | "raw";

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
  const state = (p: any) =>
    [p.deleted_at ? "deleted" : "", p.archived_at ? "archived" : "", p.hidden ? "hidden" : ""]
      .filter(Boolean)
      .join(",");
  return table(
    ["ID", "NAME", "STATE", "REMOTE", "CREATED"],
    list.map((p) => [
      p.id,
      p.name,
      state(p),
      p.remote_repo_url ?? "",
      String(p.created_at ?? "").slice(0, 10),
    ])
  );
}

function renderProject(p: any, o: RenderOpts): string {
  const repo = p.remote_repo_url ? `  ${paint(p.remote_repo_url, ANSI.dim, o.color)}` : "";
  return `${paint("✓", ANSI.green, o.color)} project ${p.name} (${p.id})${repo}`;
}

// Human ticket key when the project has a prefix, else the storage id — the
// same string the web card shows and every --id flag accepts.
const ref = (t: any): string => t.ticket_key ?? t.id ?? t.ticket;

function renderTasks(list: any[]): string {
  if (!list.length) return "(no tasks)";
  return table(
    ["KEY", "STATUS", "PRIO", "ASSIGNEE", "TITLE", "VER"],
    list.map((t) => [
      ref(t),
      t.status_key,
      t.priority ?? "",
      t.assignee_username ?? "",
      t.title,
      "v" + t.version,
    ])
  );
}

function renderTask(t: any, o: RenderOpts): string {
  const tick = paint("✓", ANSI.green, o.color);
  const st = paint(t.status_key, ANSI.cyan, o.color);
  return `${tick} ${ref(t)} "${t.title}" → ${st} (v${t.version})`;
}

// `pm task get`: the whole ticket, readable in a terminal.
function renderTaskDetail(t: any, o: RenderOpts): string {
  const dim = (s: string) => paint(s, ANSI.dim, o.color);
  const meta = [
    `status   ${paint(t.status_key, ANSI.cyan, o.color)}${t.archived_at ? " (archived)" : ""}${t.deleted_at ? " (deleted)" : ""}`,
    `priority ${t.priority ?? ""}`,
    `assignee ${t.assignee_username ?? "—"}`,
    `creator  ${t.creator_username ?? "—"}`,
    `updated  ${String(t.updated_at ?? "").replace("T", " ").slice(0, 16)}  ${dim(`v${t.version} · ${t.id}`)}`,
  ];
  const head = paint(`${ref(t)}  ${t.title}`, ANSI.bold, o.color);
  const body = t.description ? `\n\n${t.description}` : `\n\n${dim("(no description)")}`;
  return `${head}\n${meta.join("\n")}${body}`;
}

function renderStateMachine(sm: any): string {
  const statuses = table(
    ["KEY", "LABEL", "FINAL", "HIDDEN", "ORDER"],
    (sm.statuses ?? []).map((s: any) => [
      s.key,
      s.label,
      s.is_final ? "yes" : "",
      s.hidden ? "yes" : "",
      String(s.sort_order),
    ])
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
    list.map((r) => [r.ticket_key ?? r.ticket, r.projectName ?? r.project, r.priority ?? "", r.repo ?? "", r.title ?? ""])
  );
}

function renderBoard(b: any, o: RenderOpts): string {
  return (b.columns ?? [])
    .map((col: any) => {
      // CLI shows every column; hidden-from-web columns are tagged, not dropped
      // (agents/operators need full visibility).
      const hidden = col.status.hidden ? " (hidden)" : "";
      const head = paint(
        `${col.status.label} (${col.tasks.length})${hidden}`,
        ANSI.bold,
        o.color
      );
      const items = col.tasks.length
        ? col.tasks
            .map((t: any) => {
              const who = t.assignee_username ? ` @${t.assignee_username}` : "";
              return `  • ${t.title}  ${paint(ref(t) + who, ANSI.dim, o.color)}`;
            })
            .join("\n")
        : "  (empty)";
      return `${head}\n${items}`;
    })
    .join("\n\n");
}

// One history line: "#seq  time  who  what".
function activityLine(e: any, o: RenderOpts): string {
  const when = String(e.created_at ?? "").replace("T", " ").slice(5, 16);
  const who = e.actor_username ? `${e.actor_username}${e.actor_kind === "agent" ? "🤖" : ""}` : "anonymous";
  const p = e.payload ?? {};
  let what: string;
  switch (e.type) {
    case "comment": {
      const tag = e.kind && e.kind !== "note" ? `[${e.kind}${e.kind === "question" ? (e.resolved_at ? " ✓" : " open") : ""}] ` : "";
      what = `${tag}${e.body}`;
      break;
    }
    case "created": what = `created in ${p.status}`; break;
    case "status": what = `moved ${p.from} → ${p.to}`; break;
    case "field":
      what = Object.entries(p.changes ?? {})
        .map(([k, v]: [string, any]) => (k === "description" ? `description ${v.from}→${v.to} chars` : `${k} ${v.from ?? "—"} → ${v.to ?? "—"}`))
        .join(", ");
      break;
    case "link": what = `linked: ${p.label} ${p.other}`; break;
    case "unlink": what = `unlinked ${p.verb} ${p.other}`; break;
    default: what = e.type;
  }
  const key = e.ticket_key ? `${e.ticket_key} ` : "";
  return `${paint(`#${e.seq}`, ANSI.dim, o.color)} ${paint(when, ANSI.dim, o.color)} ${paint(who, ANSI.cyan, o.color)}  ${key}${what}  ${paint(e.id, ANSI.dim, o.color)}`;
}

function renderActivity(data: any, o: RenderOpts): string {
  const list = Array.isArray(data) ? data : [data];
  if (!list.length) return "(no activity)";
  return list.map((e) => activityLine(e, o)).join("\n");
}

function renderInbox(list: any[]): string {
  if (!list.length) return "(inbox empty — nothing waiting on you)";
  return table(
    ["TICKET", "PROJECT", "FROM", "QUESTION", "COMMENT ID"],
    list.map((q) => [
      q.ticket_key ?? q.task_id,
      q.project_name ?? "",
      q.actor_username ?? "anonymous",
      String(q.body ?? "").replace(/\s+/g, " ").slice(0, 80),
      q.id,
    ])
  );
}

function renderSearch(hits: any[], o: RenderOpts): string {
  if (!hits.length) return "(no matches)";
  return hits
    .map((h) => {
      const t = h.task;
      const tag = [t.status_key, t.archived_at ? "archived" : "", t.deleted_at ? "deleted" : ""].filter(Boolean).join(", ");
      const head = `${paint(ref(t), ANSI.bold, o.color)}  ${t.title}  ${paint(`${h.project_name} · ${tag}`, ANSI.dim, o.color)}`;
      return h.snippet ? `${head}\n    ${String(h.snippet).replace(/\s+/g, " ")}` : head;
    })
    .join("\n");
}

function renderOverview(ov: any, o: RenderOpts): string {
  const line = (t: any, extra = "") =>
    `  ${ref(t).padEnd(10)} ${String(t.status_key).padEnd(10)} ${String(t.priority ?? "").padEnd(6)} ${t.title}  ${paint(t.project_name + extra, ANSI.dim, o.color)}`;
  const who = ov.user ? ov.user.username : "(anonymous — set PM_TOKEN or --user)";
  const mine = ov.mine?.length ? ov.mine.map((t: any) => line(t)).join("\n") : "  (nothing open)";
  const agents = ov.agents?.length
    ? ov.agents.map((t: any) => line(t, ` @${t.assignee_username}${t.stale ? " · STALE" : ""}`)).join("\n")
    : "  (no agent work in progress)";
  return [
    paint(`My open tickets — ${who}`, ANSI.bold, o.color),
    mine,
    "",
    paint("Agents at work", ANSI.bold, o.color),
    agents,
    "",
    `Inbox: ${ov.inbox_count} open question${ov.inbox_count === 1 ? "" : "s"}${ov.inbox_count ? " (pm inbox)" : ""}`,
  ].join("\n");
}

export function render(kind: Kind, data: any, o: RenderOpts): string {
  if (o.mode === "json") return json(data);
  switch (kind) {
    case "projects": return renderProjects(data);
    case "project": return renderProject(data, o);
    case "statemachine": return renderStateMachine(data);
    case "tasks": return renderTasks(data);
    case "task": return renderTask(data, o);
    case "taskdetail": return renderTaskDetail(data, o);
    case "board": return renderBoard(data, o);
    case "ready": return renderReady(data);
    case "activity": return renderActivity(data, o);
    case "inbox": return renderInbox(data);
    case "search": return renderSearch(data, o);
    case "overview": return renderOverview(data, o);
    case "ok": return `${paint("✓", ANSI.green, o.color)} done`;
    default: return json(data);
  }
}

function errorHint(code: string): string {
  switch (code) {
    case "illegal_transition": return "Run `pm status list --project <p>` to see allowed moves.";
    case "conflict": return "Row changed elsewhere; re-read and retry with the new version.";
    case "status_changed": return "Someone else moved this ticket first; pick another one.";
    case "forbidden": return "Agents can't do this; ask a human (e.g. create in backlog and let them move it).";
    case "unauthorized": return "Check PM_TOKEN (`pm whoami`), or rotate it with `pm token rotate`.";
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
