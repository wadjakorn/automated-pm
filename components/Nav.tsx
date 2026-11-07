"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@/lib/types";
import { api } from "@/lib/client";
import { useAuth, useInboxCount } from "./useApp";
import { toast } from "./Toast";
import { Menu } from "./Menu";
import { useTheme } from "./ThemeProvider";
import { isAccentChoice, isThemePack, nextChoice } from "./theme";

// Top bar: page nav links + theme toggle + auth. The project switcher and
// "+ New project" live in the left <Sidebar> now. The selected project is
// carried in the ?project= query string so it survives navigation across pages.
//
// On phones (< md) a leading hamburger opens the project drawer, and the row
// never wraps: link padding tightens and the brand/username text drops away.
export function Nav({
  projects,
  selectedId,
  onMenu,
  menuOpen = false,
  menuRef,
  onSearch,
  live = false,
}: {
  projects: Project[];
  selectedId: string | null;
  onMenu?: () => void;
  menuOpen?: boolean;
  menuRef?: React.Ref<HTMLButtonElement>;
  // Opens the command palette (also bound to Ctrl/⌘+K by AppShell).
  onSearch?: () => void;
  // The page's live-update stream is connected.
  live?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Project menu (Settings / Appearance / Archive / Trash), a popover Menu.
  const projectBtn = useRef<HTMLButtonElement>(null);
  const [projectMenu, setProjectMenu] = useState(false);
  const closeProjectMenu = useCallback((opts?: { restoreFocus?: boolean }) => {
    setProjectMenu(false);
    if (opts?.restoreFocus !== false) projectBtn.current?.focus();
  }, []);
  const { user, refresh } = useAuth();
  // Open questions waiting on a human (agents asking). The badge is how the
  // owner notices from any page that someone is blocked on them.
  const inboxCount = useInboxCount();
  const { choice, setChoice, resolved, setPack, setAccent } = useTheme();
  const themeIcon = resolved === "dark" ? "🌙" : "☀️";
  const themeLabel = `Theme: ${choice}`;

  // Apply the selected project's theme pack + accent (persisted server-side, so
  // it follows the project across devices). Runs on selection and whenever the
  // project's stored theme changes; unknown/absent values fall back to defaults.
  // The light/dark MODE is a separate per-browser preference (the toggle below).
  const selected = projects.find((p) => p.id === selectedId);
  const selPack = selected?.theme_pack ?? null;
  const selAccent = selected?.theme_accent ?? null;
  useEffect(() => {
    setPack(isThemePack(selPack) ? selPack : "default");
    setAccent(isAccentChoice(selAccent) ? selAccent : "blue");
  }, [selPack, selAccent, setPack, setAccent]);

  async function logout() {
    try {
      await api.logout();
      await refresh();
      toast("Logged out", "success");
    } catch (e: any) {
      toast(e.message ?? "Logout failed", "error");
    }
  }

  const link = (href: string, label: React.ReactNode) => {
    const active = pathname === href;
    const q = selectedId ? `?project=${selectedId}` : "";
    return (
      <Link
        href={href + q}
        className={`px-1.5 py-1.5 text-sm sm:px-3 ${
          active
            ? "bg-accent-soft text-accent ring-1 ring-accent-border"
            : "text-fg-muted hover:text-fg"
        }`}
      >
        {label}
      </Link>
    );
  };

  const projectMenuActive =
    pathname === "/settings" ||
    pathname === "/appearance" ||
    pathname === "/archive" ||
    pathname === "/trash";

  const goProject = (href: string) =>
    router.push(href + (selectedId ? `?project=${encodeURIComponent(selectedId)}` : ""));

  return (
    <header className="theme-nav flex items-center gap-2 whitespace-nowrap border-b border-border px-2 py-2 sm:gap-4 sm:px-5 sm:py-3">
      {onMenu && (
        <button
          ref={menuRef}
          onClick={onMenu}
          aria-label="Open projects"
          aria-expanded={menuOpen}
          title="Projects"
          className="rounded px-2 py-1.5 text-fg-muted hover:text-fg md:hidden"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        </button>
      )}
      {/* Brand hides on phones; the row needs the room for its links. */}
      <span className="hidden font-semibold text-fg sm:inline">
        📋<span className="hidden min-[400px]:inline"> PM</span>
      </span>
      {live && (
        <span
          role="status"
          title="Live: changes from anyone appear as they happen"
          className="-ml-1 inline-flex items-center gap-1 text-[11px] text-fg-subtle sm:-ml-2"
        >
          <span aria-hidden="true" className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-50 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          <span className="sr-only sm:not-sr-only">live</span>
        </span>
      )}

      <nav className="ml-auto flex items-center gap-0.5 sm:gap-1">
        {onSearch && (
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search (Ctrl+K)"
            aria-keyshortcuts="Control+K Meta+K"
            title="Search tickets and commands (Ctrl/⌘+K)"
            className="mr-0.5 inline-flex items-center gap-2 rounded border border-border px-2 py-1.5 text-sm text-fg-muted hover:bg-bg-card hover:text-fg sm:mr-1 lg:min-w-44"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            >
              <circle cx="9" cy="9" r="5.5" />
              <path d="M13.5 13.5 17 17" />
            </svg>
            <span className="hidden lg:inline">Search…</span>
            <kbd className="ml-auto hidden rounded border border-border px-1 font-sans text-[10px] text-fg-subtle lg:inline">
              Ctrl K
            </kbd>
          </button>
        )}
        {link("/", "Board")}
        {link(
          "/home",
          // Phones: a shorter label keeps the row from overflowing.
          <>
            <span className="sm:hidden">Mine</span>
            <span className="hidden sm:inline">My work</span>
          </>
        )}
        <Link
          href={"/inbox" + (selectedId ? `?project=${selectedId}` : "")}
          aria-label={
            inboxCount
              ? `Inbox, ${inboxCount} open question${inboxCount === 1 ? "" : "s"}`
              : "Inbox"
          }
          className={`inline-flex items-center gap-1.5 px-1.5 py-1.5 text-sm sm:px-3 ${
            pathname === "/inbox"
              ? "bg-accent-soft text-accent ring-1 ring-accent-border"
              : "text-fg-muted hover:text-fg"
          }`}
        >
          Inbox
          {!!inboxCount && (
            <span
              aria-hidden="true"
              className="min-w-[1.25rem] rounded-full bg-accent px-1.5 text-center text-[11px] font-semibold leading-5 text-white"
            >
              {inboxCount > 99 ? "99+" : inboxCount}
            </span>
          )}
        </Link>
        <button
          ref={projectBtn}
          type="button"
          onClick={() => (projectMenu ? closeProjectMenu() : setProjectMenu(true))}
          aria-haspopup="menu"
          aria-expanded={projectMenu}
          aria-controls={projectMenu ? "project-menu" : undefined}
          className={`px-1.5 py-1.5 text-sm sm:px-3 ${
            projectMenuActive
              ? "bg-accent-soft text-accent ring-1 ring-accent-border"
              : "text-fg-muted hover:text-fg"
          }`}
        >
          Project <span aria-hidden="true">▾</span>
        </button>
        <Menu
          id="project-menu"
          label="Project"
          open={projectMenu}
          onClose={closeProjectMenu}
          anchorRef={projectBtn}
          align="end"
          items={[
            { kind: "item", label: "Settings", onSelect: () => goProject("/settings") },
            { kind: "item", label: "Appearance", onSelect: () => goProject("/appearance") },
            { kind: "separator" },
            { kind: "item", label: "Archive", onSelect: () => goProject("/archive") },
            { kind: "item", label: "Trash", onSelect: () => goProject("/trash") },
          ]}
        />
        <button
          onClick={() => setChoice(nextChoice(choice))}
          title={themeLabel}
          aria-label={themeLabel}
          className="rounded px-1.5 py-1.5 sm:px-2 text-sm text-fg-muted hover:text-fg"
        >
          {themeIcon}
        </button>
        <span className="mx-0.5 h-5 w-px bg-border sm:mx-1" />
        {user ? (
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-fg-muted sm:inline">
              👤 {user.username}
            </span>
            <button
              onClick={logout}
              title="Logout"
              className="rounded px-1.5 py-1.5 text-sm text-fg-muted hover:text-fg sm:px-2"
            >
              {/* Icon-only on phones so the row fits; the text stays for AT. */}
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="h-4 w-4 sm:hidden"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M12 6l4 4-4 4M16 10H8" />
              </svg>
              <span className="sr-only sm:not-sr-only">Logout</span>
            </button>
          </div>
        ) : (
          <>
            <Link
              href="/login"
              className="rounded px-2 py-1.5 text-sm text-fg-muted hover:text-fg sm:px-3"
            >
              Login
            </Link>
            <Link
              href="/register"
              className="rounded border border-border px-2 py-1.5 text-sm text-fg-muted hover:bg-bg-card sm:px-3"
            >
              Register
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
