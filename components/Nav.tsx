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
import {
  THEME_CHOICES,
  isAccentChoice,
  isThemePack,
  type ThemeChoice,
} from "./theme";
import { headerContext } from "./nav-logic";

// Top bar. Left: "PM / <current project>" (PM-0019) — or the page title on
// cross-project pages (/home, /inbox) — plus the live dot. The name is a button
// that shows the project list (focus the sidebar's active row on desktop, open
// the drawer on phones); it is not a switcher. Right: search + page links, then
// the ⚙ project menu and the avatar (account + theme) menu on desktop, folded
// into one ⋯ menu below `md`. The selected project is carried in ?project= so it
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
  const { choice, setChoice, setPack, setAccent } = useTheme();
  // Account menu (avatar): who you are, theme, log out.
  const avatarBtn = useRef<HTMLButtonElement>(null);
  const [avatarMenu, setAvatarMenu] = useState(false);
  const closeAvatarMenu = useCallback((opts?: { restoreFocus?: boolean }) => {
    setAvatarMenu(false);
    if (opts?.restoreFocus !== false) avatarBtn.current?.focus();
  }, []);

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
        className={`rounded px-1.5 py-1.5 text-sm sm:px-3 ${
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
    {
      kind: "item",
      label: "Appearance",
      onSelect: () => goProject("/appearance"),
    },
    { kind: "separator" },
    { kind: "item", label: "Archive", onSelect: () => goProject("/archive") },
    { kind: "item", label: "Trash", onSelect: () => goProject("/trash") },
  ];
  // Theme as radios showing the CHOICE (not the resolved mode), so picking
  // "System" visibly changes the menu even when it resolves to the same mode.
  const themeItems: MenuEntry[] = (["system", "light", "dark"] as ThemeChoice[])
    .filter((c) => THEME_CHOICES.includes(c))
    .map((c) => ({
      kind: "item",
      label: `Theme: ${c[0].toUpperCase()}${c.slice(1)}`,
      checked: choice === c,
      onSelect: () => setChoice(c),
    }));
  const accountItems: MenuEntry[] = user
    ? [
        { kind: "label", text: user.username, sub: user.kind },
        { kind: "separator" },
        ...themeItems,
        { kind: "separator" },
        { kind: "item", label: "Log out", onSelect: logout },
      ]
    : [
        ...themeItems,
        { kind: "separator" },
        {
          kind: "item",
          label: "Log in",
          onSelect: () => router.push("/login"),
        },
        {
          kind: "item",
          label: "Register",
          onSelect: () => router.push("/register"),
        },
      ];
  const moreItems: MenuEntry[] = [
    ...projectItems,
    { kind: "separator" },
    ...accountItems,
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
          <span
            aria-hidden="true"
            className="shrink-0 text-xs text-fg-subtle md:hidden"
          >
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
              <span className="absolute inline-flex h-full w-full animate-ping-once rounded-full bg-success opacity-50 motion-reduce:hidden" />
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
            aria-label="Search tickets or jump to a project (Ctrl+K)"
            aria-keyshortcuts="Control+K Meta+K"
            title="Search tickets or jump to a project… (Ctrl/⌘ K)"
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
          className={`inline-flex items-center gap-1.5 rounded px-1.5 py-1.5 text-sm sm:px-3 ${
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
            projectMenuActive
              ? "bg-accent-soft text-accent"
              : "text-fg-muted hover:text-fg"
          }`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-5 w-5"
            fill="currentColor"
          >
            <circle cx="4.5" cy="10" r="1.5" />
            <circle cx="10" cy="10" r="1.5" />
            <circle cx="15.5" cy="10" r="1.5" />
          </svg>
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
            onClick={() =>
              projectMenu ? closeProjectMenu() : setProjectMenu(true)
            }
            aria-label="Project settings"
            title="Project settings"
            aria-haspopup="menu"
            aria-expanded={projectMenu}
            aria-controls={projectMenu ? "project-menu" : undefined}
            className={`rounded p-2 ${
              projectMenuActive
                ? "bg-accent-soft text-accent ring-1 ring-accent-border"
                : "text-fg-muted hover:bg-bg-soft hover:text-fg"
            }`}
          >
            <GearIcon />
          </button>
          <Menu
            id="project-menu"
            label="Project settings"
            open={projectMenu}
            onClose={closeProjectMenu}
            anchorRef={projectBtn}
            align="end"
            items={projectItems}
          />
          <button
            ref={avatarBtn}
            type="button"
            onClick={() =>
              avatarMenu ? closeAvatarMenu() : setAvatarMenu(true)
            }
            aria-label={user ? `Account: ${user.username}` : "Account"}
            title={user ? user.username : "Account"}
            aria-haspopup="menu"
            aria-expanded={avatarMenu}
            aria-controls={avatarMenu ? "account-menu" : undefined}
            className="ml-1 rounded-full"
          >
            <span
              aria-hidden="true"
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold uppercase ${
                user
                  ? "bg-accent text-white"
                  : "border border-border text-fg-muted"
              }`}
            >
              {user ? user.username[0] : "?"}
            </span>
          </button>
          <Menu
            id="account-menu"
            label="Account"
            open={avatarMenu}
            onClose={closeAvatarMenu}
            anchorRef={avatarBtn}
            align="end"
            items={accountItems}
          />
        </div>
      </nav>
    </header>
  );
}

function GearIcon() {
  // Cog outline (Lucide "settings", ISC), 24-unit grid drawn at 20px so the
  // stroke matches the other 1.75 icons.
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
