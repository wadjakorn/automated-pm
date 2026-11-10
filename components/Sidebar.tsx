"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  KeyboardCode,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Project } from "@/lib/types";
import { api } from "@/lib/client";
import { toast } from "./Toast";
import { Menu, type MenuEntry } from "./Menu";
import {
  actionFailed,
  dropOnto,
  moveAvailability,
  moveVisible,
  neighbourAfterRemoval,
  orderForDisplay,
  stillShown,
} from "./sidebar-logic";

// Collapsible left sidebar: the project switcher (a vertical list of buttons,
// the active one highlighted) plus the "+ New project" create flow — both moved
// out of the top <Nav>. Open/closed state is persisted per-browser in
// localStorage, matching the light/dark theme convention.
//
// Each project row carries an overflow (⋯) popover menu (components/Menu.tsx,
// one shared instance anchored to the clicked ⋯; also opened by right-click
// or ContextMenu / Shift+F10 on the row) with reorder / settings / hide /
// archive / trash actions. Trash asks for confirmation inside the menu.
// Visible rows can be dragged by their grip. Hidden projects live in a
// collapsible "Hidden (n)" section after the list (open state persisted;
// forced open while the selected project is hidden), faded and not draggable.
// Menu moves stay within a row's group (visible or hidden). Archived and
// deleted projects leave the list entirely
// (see the Archive and Trash views); Hide / Archive / Trash toasts carry Undo.
//
// Below the `md` breakpoint the in-flow sidebar (rail or expanded) is not
// rendered at all — it would eat most of a phone's width. Instead the same
// contents open as an overlay drawer, driven by `mobileOpen` from the header's
// project-name button (see AppShell/Nav). It starts closed, isn't persisted, and closes
// on project select, backdrop tap or Esc. The desktop open/closed preference
// (SIDEBAR_KEY) is untouched by it.
const SIDEBAR_KEY = "sidebar:open";
const SHOW_HIDDEN_KEY = "sidebar:show-hidden";

export function Sidebar({
  projects: projectsProp,
  selectedId,
  onSelect,
  onProjectsChanged,
  mobileOpen = false,
  onMobileClose,
  revealRequest = 0,
  lastUsed = false,
}: {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onProjectsChanged: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  // Changes when the header's project name is clicked on desktop: expand and
  // focus the active row.
  revealRequest?: number;
  // A cross-project page (/home, /inbox): the selected row is styled as "last
  // used", not current.
  lastUsed?: boolean;
}) {
  // Optimistic order after a reorder, until the refetched list arrives.
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  useEffect(() => setOptimistic(null), [projectsProp]);
  const projects = optimistic
    ? [...projectsProp].sort(
        (a, b) => optimistic.indexOf(a.id) - optimistic.indexOf(b.id),
      )
    : projectsProp;
  const drawerRef = useRef<HTMLElement>(null);
  const deskRef = useRef<HTMLElement>(null);
  const router = useRouter();
  // The ⋯ button the open menu is anchored to (desktop list or mobile drawer).
  const menuAnchor = useRef<HTMLElement | null>(null);
  // Default open; the stored preference is restored on mount (below) so the
  // server render and first client render agree (no hydration mismatch).
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  // Which project's inline action menu is expanded (id) — ephemeral — and
  // whether hidden projects are revealed, persisted like the open state.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(SIDEBAR_KEY) === "0") setOpen(false);
    if (localStorage.getItem(SHOW_HIDDEN_KEY) === "1") setShowHidden(true);
  }, []);

  // Header project name → expand (persisted) and focus the active row. The
  // focus waits for the expanded aside to exist (it may still be the rail).
  const pendingReveal = useRef(false);
  useEffect(() => {
    if (!revealRequest) return;
    pendingReveal.current = true;
    setOpen(true);
    try {
      localStorage.setItem(SIDEBAR_KEY, "1");
    } catch {}
  }, [revealRequest]);
  useEffect(() => {
    if (!pendingReveal.current || !open) return;
    const root = deskRef.current;
    if (!root) return;
    pendingReveal.current = false;
    const row =
      root.querySelector<HTMLElement>("[data-selected-row]") ??
      root.querySelector<HTMLElement>("nav button");
    row?.focus();
    row?.scrollIntoView({ block: "nearest" });
  }, [open, revealRequest]);

  const toggleShowHidden = () =>
    setShowHidden((v) => {
      const next = !v;
      try {
        localStorage.setItem(SHOW_HIDDEN_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });

  // Mobile drawer: focus it on open, Esc closes, Tab stays inside (same trap
  // pattern as the task EditDrawer).
  useEffect(() => {
    if (!mobileOpen) return;
    drawerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented) return; // an inner control already handled it
        e.preventDefault();
        onMobileClose?.();
        return;
      }
      if (e.key !== "Tab" || !drawerRef.current) return;
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (
        e.shiftKey &&
        (activeEl === first || activeEl === drawerRef.current)
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen, onMobileClose]);

  // Picking a project from the list also dismisses the mobile drawer.
  const pick = (id: string) => {
    onSelect(id);
    onMobileClose?.();
  };

  const toggle = () =>
    setOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });

  async function create() {
    if (!name.trim()) return;
    try {
      const p = await api.createProject(name.trim());
      setName("");
      setCreating(false);
      onProjectsChanged();
      onSelect(p.id);
      toast(`Project "${p.name}" created`, "success");
    } catch (e: any) {
      toast(e.message ?? "Failed to create project", "error");
    }
  }

  const hiddenCount = projects.filter((p) => p.hidden).length;
  // A hidden project that is currently selected is always revealed (so the
  // active row exists), without touching the stored preference.
  const forced = projects.some((p) => p.id === selectedId && p.hidden);
  const shown = orderForDisplay(projects, showHidden || forced);
  const fullIds = projects.map((p) => p.id);
  const visibleIds = projects.filter((p) => !p.hidden).map((p) => p.id);
  const hiddenIds = projects.filter((p) => p.hidden).map((p) => p.id);
  const shownIds = shown.map((p) => p.id);
  const hiddenOpen = showHidden || forced;
  const visibleRows = shown.filter((p) => !p.hidden);
  const hiddenRows = shown.filter((p) => p.hidden);
  const groupOf = (p: Project) => (p.hidden ? hiddenIds : visibleIds);

  // Show the new order (full ordered id list) at once, persist it in one
  // request, then refresh once. On failure, drop the optimistic order.
  async function reorder(ids: string[]) {
    setOptimistic(ids);
    try {
      await api.reorderProjects(ids);
    } catch {
      setOptimistic(null);
      toast(actionFailed("reorder", "projects"), "error");
    }
    onProjectsChanged();
  }

  // Drag-and-drop (grip ⋮⋮ is the activator). Same sensors as the board:
  // mouse after 5px, touch after a 200ms long-press, keyboard Space/Enter to
  // pick up and drop, arrows to move, Esc to cancel.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      keyboardCodes: {
        start: [KeyboardCode.Space, KeyboardCode.Enter],
        cancel: [KeyboardCode.Esc],
        end: [KeyboardCode.Space, KeyboardCode.Enter],
      },
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const nameOf = (id: unknown) =>
    projects.find((p) => p.id === id)?.name ?? "project";
  const posIn = (id: unknown) => {
    const p = projects.find((x) => x.id === id);
    const g = p ? groupOf(p) : [];
    return `position ${g.indexOf(String(id)) + 1} of ${g.length}`;
  };
  const dndA11y = {
    screenReaderInstructions: {
      draggable:
        "Press Space or Enter to pick up the project. Use the Up and Down arrows to move it, Space or Enter to drop, or Escape to cancel.",
    },
    announcements: {
      onDragStart: ({ active }: any) =>
        `Picked up ${nameOf(active.id)}, ${posIn(active.id)}.`,
      onDragOver: ({ active, over }: any) =>
        over
          ? `${nameOf(active.id)} is over ${posIn(over.id)}.`
          : `${nameOf(active.id)} is not over the list.`,
      onDragEnd: ({ active, over }: any) =>
        over
          ? `Dropped ${nameOf(active.id)} at ${posIn(over.id)}.`
          : `Dropped ${nameOf(active.id)}.`,
      onDragCancel: ({ active }: any) =>
        `Reorder cancelled. ${nameOf(active.id)} stays put.`,
    },
  };
  function onDragEnd(e: DragEndEvent) {
    const p = projects.find((x) => x.id === e.active.id);
    if (!p) return;
    const next = dropOnto(
      fullIds,
      groupOf(p),
      p.id,
      e.over ? String(e.over.id) : null,
    );
    if (next) reorder(next);
  }

  // Move a project one slot within its display group (visible or hidden) and
  // persist the resulting FULL order; rows outside the group keep their place.
  function move(p: Project, to: -1 | 1 | "top" | "bottom") {
    const next = moveVisible(fullIds, groupOf(p), p.id, to);
    if (next) reorder(next);
  }

  // When an action removes the selected project from the shown list, jump to
  // its nearest shown neighbour (above, else below) so the board is never left
  // on a gap. Returns the project selected instead, for toast copy.
  function selectAfter(removedId: string): Project | null {
    if (removedId !== selectedId) return null;
    const nextId = neighbourAfterRemoval(shownIds, removedId);
    const next = nextId
      ? (projects.find((p) => p.id === nextId) ?? null)
      : null;
    if (next) onSelect(next.id);
    return next;
  }

  // Undo helper: revert via `revert`, refresh, and re-select the project when
  // it was the selected one at the time of the action.
  function undoAction(
    p: Project,
    wasSelected: boolean,
    revert: () => Promise<unknown>,
  ) {
    return {
      label: "Undo",
      onClick: async () => {
        try {
          await revert();
          onProjectsChanged();
          if (wasSelected) onSelect(p.id);
        } catch {
          toast(actionFailed("restore", p.name), "error");
        }
      },
    };
  }

  async function setHidden(p: Project, hidden: boolean) {
    const wasSelected = p.id === selectedId;
    try {
      await api.updateProject(p.id, { hidden });
      // Only move the selection if the row actually leaves the list.
      const next =
        hidden && !stillShown(projects, p.id, true, showHidden)
          ? selectAfter(p.id)
          : null;
      onProjectsChanged();
      toast(
        hidden
          ? `Hidden "${p.name}"${next ? ` · Now showing ${next.name}` : ""}`
          : `Showing "${p.name}" in sidebar`,
        "success",
        undoAction(p, wasSelected, () =>
          api.updateProject(p.id, { hidden: !hidden }),
        ),
      );
    } catch {
      toast(actionFailed(hidden ? "hide" : "show", p.name), "error");
    }
  }

  async function archive(p: Project) {
    const wasSelected = p.id === selectedId;
    try {
      await api.archiveProject(p.id);
      const next = selectAfter(p.id);
      onProjectsChanged();
      toast(
        `Archived "${p.name}"${next ? ` · Now showing ${next.name}` : ""}`,
        "success",
        undoAction(p, wasSelected, () => api.unarchiveProject(p.id)),
      );
    } catch {
      toast(actionFailed("archive", p.name), "error");
    }
  }

  // Confirmation happens in the menu (Move to Trash… → confirm view).
  async function del(p: Project) {
    const wasSelected = p.id === selectedId;
    try {
      await api.deleteProject(p.id);
      const next = selectAfter(p.id);
      onProjectsChanged();
      toast(
        `Moved "${p.name}" to Trash${next ? ` · Now showing ${next.name}` : ""}`,
        "success",
        undoAction(p, wasSelected, () => api.restoreProject(p.id)),
      );
    } catch {
      toast(actionFailed("move", p.name), "error");
    }
  }

  const openMenu = (id: string, el: HTMLElement) => {
    menuAnchor.current = el;
    setMenuFor(id);
  };
  const closeMenu = useCallback((opts?: { restoreFocus?: boolean }) => {
    setMenuFor(null);
    if (opts?.restoreFocus !== false) menuAnchor.current?.focus();
  }, []);

  // Items for a project's ⋯ menu. Moves are limited to the row's display group
  // (visible or hidden), so an edge is never blocked by an unseen neighbour.
  function menuItems(p: Project): MenuEntry[] {
    const group = groupOf(p);
    const can = moveAvailability(group.indexOf(p.id), group.length);
    const go = (path: string) => {
      router.push(`${path}?project=${encodeURIComponent(p.id)}`);
      onMobileClose?.();
    };
    return [
      {
        kind: "item",
        label: "Move to top",
        disabled: !can.top,
        onSelect: () => move(p, "top"),
      },
      {
        kind: "item",
        label: "Move up",
        disabled: !can.up,
        onSelect: () => move(p, -1),
      },
      {
        kind: "item",
        label: "Move down",
        disabled: !can.down,
        onSelect: () => move(p, 1),
      },
      {
        kind: "item",
        label: "Move to bottom",
        disabled: !can.bottom,
        onSelect: () => move(p, "bottom"),
      },
      { kind: "separator" },
      { kind: "item", label: "Settings", onSelect: () => go("/settings") },
      { kind: "item", label: "Appearance", onSelect: () => go("/appearance") },
      { kind: "separator" },
      {
        kind: "item",
        label: p.hidden ? "Show in sidebar" : "Hide from sidebar",
        onSelect: () => setHidden(p, !p.hidden),
      },
      { kind: "item", label: "Archive", onSelect: () => archive(p) },
      { kind: "separator" },
      {
        kind: "item",
        label: "Move to Trash…",
        danger: true,
        confirm: {
          prompt: `Move "${p.name}" to Trash?`,
          confirmLabel: "Move to Trash",
        },
        onSelect: () => del(p),
      },
    ];
  }
  const menuProject = menuFor
    ? (projects.find((p) => p.id === menuFor) ?? null)
    : null;

  // Sidebar title row with a close control (« collapse on desktop, ✕ in the
  // mobile drawer).
  const header = (control: React.ReactNode) => (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        Projects
      </span>
      {control}
    </div>
  );

  // Project list + hidden toggle + create flow. Shared by the desktop sidebar
  // and the mobile drawer; CSS guarantees only one is ever displayed.
  const body = (
    <>
      <ScrollFadeNav label="Projects">
        {visibleRows.length === 0 && (
          <p className="px-2 py-1 text-sm text-fg-subtle">
            {projects.length === 0 ? (
              "No projects yet"
            ) : (
              <>
                No visible projects.{" "}
                {!hiddenOpen && (
                  <button
                    onClick={toggleShowHidden}
                    className="underline hover:text-fg"
                  >
                    Show hidden
                  </button>
                )}
              </>
            )}
          </p>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={dndA11y}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={visibleRows.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            {visibleRows.map((p) => (
              <ProjectRow
                key={p.id}
                p={p}
                active={p.id === selectedId}
                lastUsed={lastUsed}
                menuOpen={menuFor === p.id}
                onPick={() => pick(p.id)}
                onOpenMenu={(el) => openMenu(p.id, el)}
                onCloseMenu={() => closeMenu()}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* Hidden projects: a collapsible section after the list. Workspace-
            wide (every user sees the same), ordered by sort_order, not
            draggable. Forced open while the selected project is hidden. */}
        {hiddenCount > 0 && (
          <div className="pt-2">
            <button
              onClick={toggleShowHidden}
              disabled={forced}
              aria-expanded={hiddenOpen}
              title={
                forced
                  ? "Open because the current project is hidden"
                  : undefined
              }
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg disabled:cursor-default disabled:hover:text-fg-subtle"
            >
              <span
                aria-hidden="true"
                className={`transition-transform ${hiddenOpen ? "rotate-90" : ""}`}
              >
                ▸
              </span>
              Hidden ({hiddenCount})
            </button>
            {hiddenOpen &&
              hiddenRows.map((p) => (
                <ProjectRow
                  key={p.id}
                  p={p}
                  dimmed
                  active={p.id === selectedId}
                  lastUsed={lastUsed}
                  menuOpen={menuFor === p.id}
                  onPick={() => pick(p.id)}
                  onOpenMenu={(el) => openMenu(p.id, el)}
                  onCloseMenu={() => closeMenu()}
                  onShow={
                    p.id === selectedId ? () => setHidden(p, false) : undefined
                  }
                />
              ))}
          </div>
        )}
      </ScrollFadeNav>

      <div className="border-t border-border p-2">
        {creating ? (
          <div className="space-y-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
                if (e.key === "Escape") {
                  e.preventDefault(); // cancel the create only, not the mobile drawer
                  setCreating(false);
                }
              }}
              placeholder="Project name"
              className="w-full rounded border border-border bg-bg-card px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button
                onClick={create}
                className="flex-1 rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
              >
                Add
              </button>
              <button
                onClick={() => setCreating(false)}
                className="rounded px-2 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-bg-card"
          >
            + New project
          </button>
        )}
      </div>
    </>
  );

  return (
    <>
      {open ? (
        <aside
          ref={deskRef}
          className="theme-nav hidden h-full w-56 shrink-0 flex-col border-r border-border md:flex"
        >
          {header(
            <button
              onClick={toggle}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              aria-expanded={true}
              className="rounded px-2 py-0.5 text-fg-muted hover:text-fg"
            >
              «
            </button>,
          )}
          {body}
        </aside>
      ) : (
        // Collapsed: a narrow rail with just the expand toggle.
        <aside className="theme-nav hidden h-full w-11 shrink-0 flex-col items-center border-r border-border md:flex">
          <div className="flex h-14 w-full shrink-0 items-center justify-center border-b border-border">
            <button
              onClick={toggle}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              aria-expanded={false}
              className="rounded px-2 py-1.5 text-fg-muted hover:text-fg"
            >
              »
            </button>
          </div>
        </aside>
      )}

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            aria-hidden="true"
            onClick={onMobileClose}
            className="absolute inset-0 animate-fade-in bg-black/50"
          />
          {/* Opaque bg-bg under theme-nav: some packs use a translucent nav
              background, which would let the board show through the drawer. */}
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Projects"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 w-64 max-w-[85vw] animate-drawer-in-left border-r border-border bg-bg shadow-xl outline-none"
          >
            <div className="theme-nav flex h-full flex-col">
              {header(
                <button
                  onClick={onMobileClose}
                  aria-label="Close projects"
                  className="rounded px-2 py-0.5 text-fg-muted hover:text-fg"
                >
                  ✕
                </button>,
              )}
              {body}
            </div>
          </aside>
        </div>
      )}

      <Menu
        id="project-row-menu"
        label={
          menuProject ? `Actions for ${menuProject.name}` : "Project actions"
        }
        open={!!menuProject}
        onClose={closeMenu}
        anchorRef={menuAnchor}
        items={menuProject ? menuItems(menuProject) : []}
      />
    </>
  );
}

// One sortable project row: grip ⋮⋮ (the drag activator, so dnd-kit's
// role/tabIndex/aria attributes land on the grip, not the row), the project
// button, and the ⋯ menu trigger. Grip and ⋯ show on row hover / focus, on the
// active row, and always on touch screens.
const REVEAL =
  "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100";

function ProjectRow({
  p,
  active,
  lastUsed,
  menuOpen,
  onPick,
  onOpenMenu,
  onCloseMenu,
  dimmed = false,
  onShow,
}: {
  p: Project;
  // A row in the Hidden section: italic (fg-muted keeps 4.5:1), no grip.
  dimmed?: boolean;
  // Quick "Show" (the selected hidden project).
  onShow?: () => void;
  active: boolean;
  lastUsed: boolean;
  menuOpen: boolean;
  onPick: () => void;
  onOpenMenu: (el: HTMLElement) => void;
  onCloseMenu: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: p.id, disabled: dimmed });
  const openFromRow = (root: HTMLElement | null | undefined) => {
    const btn = root?.querySelector<HTMLElement>("[data-row-menu]");
    if (btn) onOpenMenu(btn);
  };
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group relative flex items-center gap-0.5 ${
        isDragging ? "z-10 rounded bg-bg-card shadow-md" : ""
      }`}
      onContextMenu={(e) => {
        e.preventDefault();
        openFromRow(e.currentTarget);
      }}
    >
      {dimmed ? (
        <span aria-hidden="true" className="w-3 shrink-0" />
      ) : (
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${p.name}`}
          title="Drag to reorder"
          className={`shrink-0 cursor-grab touch-none rounded px-0.5 py-1.5 text-xs leading-none text-fg-subtle hover:text-fg active:cursor-grabbing ${
            isDragging || active ? "" : REVEAL
          }`}
        >
          <span aria-hidden="true">⋮⋮</span>
        </button>
      )}
      <button
        onClick={onPick}
        onKeyDown={(e) => {
          if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
            e.preventDefault();
            openFromRow(e.currentTarget.parentElement);
          }
        }}
        data-selected-row={active || undefined}
        aria-current={active && !lastUsed ? "page" : undefined}
        title={active && lastUsed ? `${p.name} (last used)` : p.name}
        className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${
          active && !lastUsed
            ? "bg-accent-soft text-accent ring-1 ring-accent-border"
            : active
              ? "text-fg ring-1 ring-border hover:bg-bg-soft"
              : dimmed
                ? "italic text-fg-muted hover:bg-bg-soft hover:text-fg"
                : "text-fg-muted hover:bg-bg-soft hover:text-fg"
        }`}
      >
        <span className="truncate">{p.name}</span>
      </button>
      {onShow && (
        <button
          onClick={onShow}
          title="Show in sidebar"
          className="shrink-0 rounded px-1.5 py-1 text-xs text-accent hover:bg-bg-soft"
        >
          Show
        </button>
      )}
      <button
        data-row-menu
        onClick={(e) =>
          menuOpen ? onCloseMenu() : onOpenMenu(e.currentTarget)
        }
        aria-label={`Actions for ${p.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? "project-row-menu" : undefined}
        title="Project actions"
        className={`shrink-0 rounded px-1.5 py-1.5 text-fg-subtle hover:bg-bg-soft hover:text-fg ${
          menuOpen ? "bg-bg-soft text-fg" : active ? "" : REVEAL
        }`}
      >
        ⋯
      </button>
    </div>
  );
}

// The scrolling project list. A fade at the bottom edge says "more below"
// while it can still scroll (instead of cutting a row mid-glyph).
function ScrollFadeNav({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => ro.disconnect();
  });
  return (
    <nav
      ref={ref}
      aria-label={label}
      onScroll={measure}
      className={`flex-1 space-y-0.5 overflow-y-auto px-2 pb-2 ${
        more
          ? "[mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]"
          : ""
      }`}
    >
      {children}
    </nav>
  );
}
