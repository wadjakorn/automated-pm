"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@/lib/types";
import { api } from "@/lib/client";
import { useAuth, useInboxCount } from "./useApp";
import { toast } from "./Toast";
import { Menu, type MenuEntry } from "./Menu";
import { useTheme } from "./ThemeProvider";
import { isAccentChoice, isThemePack, nextChoice } from "./theme";
import { headerContext } from "./nav-logic";

// Top bar. Left: "PM / <current project>" (PM-0019) — or the page title on
// cross-project pages (/home, /inbox) — plus the live dot. The name is a button
// that shows the project list (focus the sidebar's active row on desktop, open
// the drawer on phones); it is not a switcher. Right: search + page links, then
// the Project menu, theme toggle and account on desktop, folded into one ⋯
// menu below `md`. The selected project is carried in ?project= so it
// survives navigation across pages.
export function Nav({
  projects,
  selectedId,
  onProjectName,
  menuOpen = false,
  menuRef,
  onSearch,
  live = false,
}: {
  projects: Project[];
  selectedId: string | null;
  // The project-name button: reveal the sidebar (desktop) or open the drawer.
  onProjectName?: () => void;
  // The mobile drawer is open (aria-expanded on the name button).
  menuOpen?: boolean;
  // Focus returns here when the mobile drawer closes.
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
  // Phones: one ⋯ menu for the project pages, theme and account.
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [moreMenu, setMoreMenu] = useState(false);
  const closeMoreMenu = useCallback((opts?: { restoreFocus?: boolean }) => {
    setMoreMenu(false);
    if (opts?.restoreFocus !== false) moreBtn.current?.focus();
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

  const q = selectedId ? `?project=${encodeURIComponent(selectedId)}` : "";
  const ctx = headerContext(projects, selectedId, pathname);

  const link = (href: string, label: React.ReactNode) => {
    const active = pathname === href;
    return (
      <Link
        href={href + q}
        aria-current={active ? "page" : undefined}
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

  const goProject = (href: string) => router.push(href + q);
  const projectItems: MenuEntry[] = [
    { kind: "item", label: "Settings", onSelect: () => goProject("/settings") },
    { kind: "item", label: "Appearance", onSelect: () => goProject("/appearance") },
    { kind: "separator" },
    { kind: "item", label: "Archive", onSelect: () => goProject("/archive") },
    { kind: "item", label: "Trash", onSelect: () => goProject("/trash") },
  ];
  const moreItems: MenuEntry[] = [
    ...projectItems,
    { kind: "separator" },
    {
      kind: "item",
      label: `Theme: ${choice} → ${nextChoice(choice)}`,
      onSelect: () => setChoice(nextChoice(choice)),
    },
    ...(user
      ? [{ kind: "item" as const, label: `Logout (${user.username})`, onSelect: logout }]
      : [
          { kind: "item" as const, label: "Login", onSelect: () => router.push("/login") },
          { kind: "item" as const, label: "Register", onSelect: () => router.push("/register") },
        ]),
  ];

  const title = ctx.title ?? (projects.length ? "Select a project" : "");

  return (
    <header className="theme-nav flex h-14 shrink-0 items-center gap-2 whitespace-nowrap border-b border-border px-2 sm:gap-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Link
          href={"/" + q}
          className="hidden shrink-0 font-semibold text-fg hover:text-accent sm:inline"
        >
          PM
        </Link>
        <span aria-hidden="true" className="hidden text-fg-subtle sm:inline">
          /
        </span>
        <button
          ref={menuRef}
          type="button"
          onClick={onProjectName}
          aria-expanded={menuOpen}
          aria-label={title ? `${title}, show projects` : "Show projects"}
          title={ctx.title ?? undefined}
          className="flex min-w-0 items-baseline gap-1.5 rounded px-1.5 py-1 text-left hover:bg-bg-soft"
        >
          <span
            className={`truncate font-semibold ${ctx.title ? "text-fg" : "text-fg-subtle"}`}
          >
            {title}
          </span>
          {ctx.prefix && (
            <span className="hidden shrink-0 text-xs text-fg-subtle min-[400px]:inline">
              {ctx.prefix}
            </span>
          )}
          {/* Opens the drawer on phones. */}
          <span aria-hidden="true" className="shrink-0 text-xs text-fg-subtle md:hidden">
            ▾
          </span>
        </button>
        {live && (
          <span
            role="status"
            title="Live: changes from anyone appear as they happen"
            className="inline-flex shrink-0 items-center gap-1 text-[11px] text-fg-subtle"
          >
            <span aria-hidden="true" className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-50 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            <span className="sr-only lg:not-sr-only">live</span>
          </span>
        )}
      </div>

      <nav className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
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
        {link("/home", "My work")}
        <Link
          href={"/inbox" + q}
          aria-current={pathname === "/inbox" ? "page" : undefined}
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

        {/* Phones: one ⋯ menu for everything below. */}
        <button
          ref={moreBtn}
          type="button"
          onClick={() => (moreMenu ? closeMoreMenu() : setMoreMenu(true))}
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={moreMenu}
          aria-controls={moreMenu ? "more-menu" : undefined}
          className={`rounded px-2 py-1.5 text-sm md:hidden ${
            projectMenuActive ? "bg-accent-soft text-accent" : "text-fg-muted hover:text-fg"
          }`}
        >
          ⋯
        </button>
        <Menu
          id="more-menu"
          label="More"
          open={moreMenu}
          onClose={closeMoreMenu}
          anchorRef={moreBtn}
          align="end"
          items={moreItems}
        />

        <div className="hidden items-center gap-1 md:flex">
          <button
            ref={projectBtn}
            type="button"
            onClick={() => (projectMenu ? closeProjectMenu() : setProjectMenu(true))}
            aria-haspopup="menu"
            aria-expanded={projectMenu}
            aria-controls={projectMenu ? "project-menu" : undefined}
            className={`px-3 py-1.5 text-sm ${
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
            items={projectItems}
          />
          <button
            onClick={() => setChoice(nextChoice(choice))}
            title={themeLabel}
            aria-label={themeLabel}
            className="rounded px-2 py-1.5 text-sm text-fg-muted hover:text-fg"
          >
            {themeIcon}
          </button>
          <span className="mx-1 h-5 w-px bg-border" />
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-fg-muted">👤 {user.username}</span>
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
                className="rounded px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                Login
              </Link>
              <Link
                href="/register"
                className="rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-bg-card"
              >
                Register
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
