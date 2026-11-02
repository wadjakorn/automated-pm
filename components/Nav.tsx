"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import type { Project } from "@/lib/types";
import { api } from "@/lib/client";
import { useAuth, useInboxCount } from "./useApp";
import { toast } from "./Toast";
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
}: {
  projects: Project[];
  selectedId: string | null;
  onMenu?: () => void;
  menuOpen?: boolean;
  menuRef?: React.Ref<HTMLButtonElement>;
}) {
  const pathname = usePathname();
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

  const link = (href: string, label: string) => {
    const active = pathname === href;
    const q = selectedId ? `?project=${selectedId}` : "";
    return (
      <Link
        href={href + q}
        className={`px-2 py-1.5 text-sm sm:px-3 ${
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

  const projectLink = (href: string, label: string) => {
    const active = pathname === href;
    const q = selectedId ? `?project=${selectedId}` : "";
    return (
      <Link
        href={href + q}
        className={`block rounded px-3 py-2 text-sm ${
          active
            ? "bg-accent-soft text-accent"
            : "text-fg-muted hover:bg-bg-soft hover:text-fg"
        }`}
      >
        {label}
      </Link>
    );
  };

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
      <span className="font-semibold text-fg">
        📋<span className="hidden min-[400px]:inline"> PM</span>
      </span>

      <nav className="ml-auto flex items-center gap-0.5 sm:gap-1">
        {link("/", "Board")}
        <Link
          href={"/inbox" + (selectedId ? `?project=${selectedId}` : "")}
          aria-label={
            inboxCount
              ? `Inbox, ${inboxCount} open question${inboxCount === 1 ? "" : "s"}`
              : "Inbox"
          }
          className={`inline-flex items-center gap-1.5 px-2 py-1.5 text-sm sm:px-3 ${
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
        <details className="group relative">
          <summary
            className={`list-none px-2 py-1.5 text-sm cursor-pointer sm:px-3 ${
              projectMenuActive
                ? "bg-accent-soft text-accent ring-1 ring-accent-border"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            Project
          </summary>
          <div className="theme-panel absolute right-0 z-20 mt-2 min-w-40 border border-border bg-bg-card p-2">
            {projectLink("/settings", "Settings")}
            {projectLink("/appearance", "Appearance")}
            {projectLink("/archive", "Archive")}
            {projectLink("/trash", "Trash")}
          </div>
        </details>
        <button
          onClick={() => setChoice(nextChoice(choice))}
          title={themeLabel}
          aria-label={themeLabel}
          className="rounded px-2 py-1.5 text-sm text-fg-muted hover:text-fg"
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
              className="rounded px-2 py-1.5 text-sm text-fg-muted hover:text-fg"
            >
              Logout
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
