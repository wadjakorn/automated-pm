"use client";

import { useCallback, useRef, useState } from "react";
import type { Project } from "@/lib/types";
import { Nav } from "./Nav";
import { Sidebar } from "./Sidebar";

// App chrome shared by every page: the collapsible project Sidebar on the left,
// then a vertical stack of the top Nav + the page content. `contentClassName`
// overrides the content wrapper for pages (the board) that manage their own
// scroll/layout instead of the default vertical scroll.
//
// Below `md` the sidebar becomes an overlay drawer opened from the Nav's
// hamburger; its open state lives here so the two can talk.
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  // Stable identity: Sidebar's focus/Esc effect depends on it. Focus goes back
  // to the hamburger so keyboard users don't land on <body>.
  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    menuRef.current?.focus();
  }, []);

  return (
    <div className="flex h-screen">
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={select}
        onProjectsChanged={reload}
        mobileOpen={mobileOpen}
        onMobileClose={closeMobile}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Nav
          projects={projects}
          selectedId={selectedId}
          menuRef={menuRef}
          menuOpen={mobileOpen}
          onMenu={() => setMobileOpen(true)}
        />
        <div className={contentClassName ?? "flex-1 overflow-y-auto"}>{children}</div>
      </div>
    </div>
  );
}
