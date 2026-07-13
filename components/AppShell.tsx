"use client";

import type { Project } from "@/lib/types";
import { Nav } from "./Nav";
import { Sidebar } from "./Sidebar";

// App chrome shared by every page: the collapsible project Sidebar on the left,
// then a vertical stack of the top Nav + the page content. `contentClassName`
// overrides the content wrapper for pages (the board) that manage their own
// scroll/layout instead of the default vertical scroll.
export function AppShell({
  projects,
  selectedId,
  select,
  reload,
  children,
  contentClassName,
}: {
  projects: Project[];
  selectedId: string | null;
  select: (id: string) => void;
  reload: () => void;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  return (
    <div className="flex h-screen">
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={select}
        onProjectsChanged={reload}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Nav projects={projects} selectedId={selectedId} />
        <div className={contentClassName ?? "flex-1 overflow-y-auto"}>{children}</div>
      </div>
    </div>
  );
}
