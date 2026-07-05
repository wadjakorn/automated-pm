"use client";

import { AppShell } from "./AppShell";
import { AppearanceSettings } from "./AppearanceSettings";
import { useProjects } from "./useApp";

export function AppearancePage() {
  const { projects, selectedId, select, reload } = useProjects();

  return (
    <AppShell
      projects={projects}
      selectedId={selectedId}
      select={select}
      reload={reload}
    >
      <div className="mx-auto max-w-4xl">
        <AppearanceSettings />
      </div>
    </AppShell>
  );
}
