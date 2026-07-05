"use client";

import { Nav } from "./Nav";

export function AppShell({
  projects,
  selectedId,
  select,
  reload,
  children,
}: {
  projects: any[];
  selectedId: string | null;
  select: (id: string) => void;
  reload: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col">
      <Nav
        projects={projects}
        selectedId={selectedId}
        onSelect={select}
        onProjectsChanged={reload}
      />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
