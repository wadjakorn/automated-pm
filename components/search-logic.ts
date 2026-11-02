// Pure helpers for the command palette (Ctrl/⌘+K): snippet highlighting and
// the non-search actions offered next to the ticket hits. Kept free of React
// and the DOM so they are unit-testable.
import type { Project, Task } from "@/lib/types";

export interface SnippetPart {
  text: string;
  hit: boolean;
}

// The search API marks each match as `[hit]` inside the snippet. Split it into
// plain/highlighted runs. A bracket without its partner (the excerpt was cut,
// or the text itself has a stray bracket) stays literal text.
//
// The delimiters are the same characters ticket text often uses ("[bug] …"),
// so when the query is given, a bracketed run only counts as a hit if it
// overlaps a query term (either contains the other; the server may mark just
// part of a word). Anything else is kept literally, brackets included.
export function parseSnippet(snippet: string | null | undefined, query?: string): SnippetPart[] {
  if (!snippet) return [];
  const terms = (query ?? "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const isHit = (inner: string) => {
    if (!terms.length) return true;
    const s = inner.toLocaleLowerCase();
    return terms.some((t) => s.includes(t) || t.includes(s));
  };
  const parts: SnippetPart[] = [];
  const push = (text: string, hit: boolean) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += text;
    else parts.push({ text, hit });
  };
  let i = 0;
  while (i < snippet.length) {
    const open = snippet.indexOf("[", i);
    if (open === -1) {
      push(snippet.slice(i), false);
      break;
    }
    const close = snippet.indexOf("]", open + 1);
    if (close === -1) {
      push(snippet.slice(i), false);
      break;
    }
    push(snippet.slice(i, open), false);
    const inner = snippet.slice(open + 1, close);
    // `[]` carries no hit; keep it literal rather than dropping characters.
    if (inner && isHit(inner)) push(inner, true);
    else push(`[${inner}]`, false);
    i = close + 1;
  }
  return parts;
}

// Board URL that opens a ticket's drawer (same shape the inbox links use).
export function ticketHref(t: Pick<Task, "project_id" | "id" | "ticket_key">): string {
  const sp = new URLSearchParams({ project: t.project_id, task: t.ticket_key ?? t.id });
  return `/?${sp.toString()}`;
}

export type PaletteAction =
  | { kind: "project"; id: string; label: string; projectId: string }
  | { kind: "new-ticket"; id: string; label: string; projectId: string; title: string }
  | { kind: "nav"; id: string; label: string; href: string };

const NAV_TARGETS: { id: string; label: string; href: string; words: string[] }[] = [
  { id: "nav:home", label: "My work", href: "/home", words: ["my work", "home", "mine"] },
  { id: "nav:inbox", label: "Inbox", href: "/inbox", words: ["inbox", "questions"] },
];

const MAX_PROJECTS = 6;

const norm = (s: string) => s.toLocaleLowerCase().trim();

// Actions that match what the user typed, in display order:
// "Go to <project>" (name contains the query; all projects when empty),
// the Inbox / My work pages, then "New ticket in <current project>" with the
// query as its title (only for a non-empty query and a known project).
export function paletteActions(
  query: string,
  ctx: { projects: Pick<Project, "id" | "name">[]; currentProject: Pick<Project, "id" | "name"> | null }
): PaletteAction[] {
  const q = norm(query);
  const out: PaletteAction[] = [];

  const projects = ctx.projects
    .filter((p) => !q || norm(p.name).includes(q))
    // Prefix matches first, then the original (sidebar) order.
    .map((p, i) => ({ p, i, prefix: q && norm(p.name).startsWith(q) ? 0 : 1 }))
    .sort((a, b) => a.prefix - b.prefix || a.i - b.i)
    .slice(0, MAX_PROJECTS);
  for (const { p } of projects) {
    out.push({ kind: "project", id: `project:${p.id}`, label: `Go to ${p.name}`, projectId: p.id });
  }

  for (const n of NAV_TARGETS) {
    if (!q || n.words.some((w) => w.includes(q) || q.includes(w))) {
      out.push({ kind: "nav", id: n.id, label: n.label, href: n.href });
    }
  }

  const title = query.trim();
  if (title && ctx.currentProject) {
    out.push({
      kind: "new-ticket",
      id: "new-ticket",
      label: `New ticket in ${ctx.currentProject.name}`,
      projectId: ctx.currentProject.id,
      title,
    });
  }
  return out;
}

// Where actions go relative to the ticket hits. A project whose name STARTS
// with the query is most likely a jump ("cap" → capz), so it leads; every
// other action follows the hits (a ticket key or phrase is a search).
export function splitActions(
  actions: PaletteAction[],
  query: string,
  projects: Pick<Project, "id" | "name">[]
): { lead: PaletteAction[]; rest: PaletteAction[] } {
  const q = norm(query);
  const lead: PaletteAction[] = [];
  const rest: PaletteAction[] = [];
  for (const a of actions) {
    const name = a.kind === "project" ? projects.find((p) => p.id === a.projectId)?.name : null;
    if (q && name && norm(name).startsWith(q)) lead.push(a);
    else rest.push(a);
  }
  return { lead, rest };
}
