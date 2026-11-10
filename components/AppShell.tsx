"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { Project } from "@/lib/types";
import { CommandPalette } from "./CommandPalette";
import { Nav } from "./Nav";
import { Sidebar } from "./Sidebar";
import { GLOBAL_PAGES } from "./nav-logic";

// App chrome shared by every page: the collapsible project Sidebar on the left,
// then a vertical stack of the top Nav + the page content. `contentClassName`
// overrides the content wrapper for pages (the board) that manage their own
// scroll/layout instead of the default vertical scroll.
//
// Below `md` the sidebar becomes an overlay drawer opened from the Nav's
// project-name button; its open state lives here so the two can talk. On
// desktop the same button expands the sidebar and focuses the active row.
// Cross-project pages (/home, /inbox) keep the selection but the sidebar shows
// it as "last used" rather than current.
export function AppShell({
  projects,
  selectedId,
  select,
  reload,
  children,
  contentClassName,
  live = false,
}: {
  projects: Project[];
  selectedId: string | null;
  select: (id: string) => void;
  reload: () => void;
  children: React.ReactNode;
  contentClassName?: string;
  // The page's live-update stream is connected (shows a dot in the Nav).
  live?: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Bumped by the header's project-name button on desktop: Sidebar expands
  // and focuses the active row each time it changes.
  const [revealRequest, setRevealRequest] = useState(0);
  const pathname = usePathname();
  const lastUsed = pathname in GLOBAL_PAGES;
  const onProjectName = useCallback(() => {
    if (window.matchMedia("(min-width: 768px)").matches)
      setRevealRequest((n) => n + 1);
    else setMobileOpen(true);
  }, []);

  // Ctrl/⌘+K opens the command palette from anywhere (and closes it again).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const menuRef = useRef<HTMLButtonElement>(null);
  // Stable identity: Sidebar's focus/Esc effect depends on it. Focus goes back
  // to the project-name button so keyboard users don't land on <body>.
  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    menuRef.current?.focus();
  }, []);

  return (
    <div className="flex h-screen supports-[height:100dvh]:h-dvh">
      {/* First tab stop on every page: jump past the sidebar and header. */}
      <a
        href="#main"
        className="sr-only z-50 rounded bg-bg-card px-3 py-2 text-sm text-fg shadow focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Skip to content
      </a>
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={select}
        onProjectsChanged={reload}
        mobileOpen={mobileOpen}
        onMobileClose={closeMobile}
        revealRequest={revealRequest}
        lastUsed={lastUsed}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Nav
          projects={projects}
          selectedId={selectedId}
          menuRef={menuRef}
          menuOpen={mobileOpen}
          onProjectName={onProjectName}
          onSearch={() => setPaletteOpen(true)}
          live={live}
        />
        <div
          id="main"
          tabIndex={-1}
          className={`outline-none ${contentClassName ?? "flex-1 overflow-y-auto"}`}
        >
          {children}
        </div>
      </div>
      {paletteOpen && (
        <CommandPalette
          onClose={closePalette}
          projects={projects}
          currentProjectId={selectedId}
        />
      )}
    </div>
  );
}
