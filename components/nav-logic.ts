import type { Project } from "@/lib/types";

// What the header shows next to the brand (PM-0019). Cross-project pages show
// their own title; every other page shows the selected project. The selection
// itself is never cleared — the theme and ?project= links depend on it.
export const GLOBAL_PAGES: Record<string, string> = {
  "/home": "My work",
  "/inbox": "Inbox",
};

export type HeaderContext = {
  kind: "project" | "global";
  title: string | null;
  prefix: string | null;
};

export function headerContext(
  projects: Pick<Project, "id" | "name" | "ticket_prefix">[],
  selectedId: string | null,
  pathname: string
): HeaderContext {
  const global = GLOBAL_PAGES[pathname];
  if (global) return { kind: "global", title: global, prefix: null };
  const p = projects.find((x) => x.id === selectedId);
  return { kind: "project", title: p?.name ?? null, prefix: p?.ticket_prefix ?? null };
}
