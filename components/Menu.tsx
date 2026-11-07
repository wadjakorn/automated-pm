"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { nextEnabledIndex, placeMenu } from "./menu-logic";

// Popover action menu anchored to a trigger button (PM-0018). Rendered in a
// portal on <body> with position: fixed, because the sidebar's .theme-nav uses
// backdrop-filter, which would trap a fixed child inside the scrolling list.
// Theme variables live on :root, so the portal keeps the project theme.
//
// Closes on Esc, Tab, item select, outside pointerdown, window resize, and
// scroll outside the menu. Esc / Tab / select return focus to the trigger;
// an outside click leaves focus where the user clicked. Esc calls
// preventDefault so the mobile drawer's document listener ignores it.
//
// An item with `confirm` swaps the list for a confirm view instead of firing.

export type MenuEntry =
  | {
      kind: "item";
      label: string;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
      confirm?: { prompt: string; confirmLabel: string };
    }
  | { kind: "separator" };

type Item = Extract<MenuEntry, { kind: "item" }>;

export function Menu({
  open,
  onClose,
  anchorRef,
  items,
  align = "start",
  label,
  id,
}: {
  open: boolean;
  onClose: (opts?: { restoreFocus?: boolean }) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  items: MenuEntry[];
  align?: "start" | "end";
  label: string;
  id: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [confirming, setConfirming] = useState<Item | null>(null);

  const actionable = items.filter((e): e is Item => e.kind === "item");
  itemRefs.current.length = actionable.length;
  const disabled = actionable.map((e) => !!e.disabled);

  // Reset per opening.
  useEffect(() => {
    if (!open) {
      setPos(null);
      setConfirming(null);
    }
  }, [open]);

  // Measure after render, then place next to the anchor.
  useLayoutEffect(() => {
    if (!open || !menuRef.current || !anchorRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const m = menuRef.current.getBoundingClientRect();
    setPos(
      placeMenu(
        a,
        { width: m.width, height: m.height },
        { width: window.innerWidth, height: window.innerHeight },
        align
      )
    );
  }, [open, align, anchorRef, confirming]);

  // Focus the first enabled item (or the confirm button) once placed.
  useEffect(() => {
    if (!open || !pos) return;
    if (confirming) {
      menuRef.current?.querySelector<HTMLButtonElement>("[data-confirm]")?.focus();
      return;
    }
    const i = nextEnabledIndex(disabled, -1, "first");
    if (i >= 0) itemRefs.current[i]?.focus();
    else menuRef.current?.focus();
    // Only on open / view change, not on every items re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos !== null, confirming]);

  // Outside pointerdown, resize, and outside scroll close the menu.
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      t instanceof Node &&
      (menuRef.current?.contains(t) || anchorRef.current?.contains(t));
    const onPointer = (e: PointerEvent) => {
      if (!inside(e.target)) onClose({ restoreFocus: false });
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) onClose({ restoreFocus: false });
    };
    const onResize = () => onClose({ restoreFocus: false });
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  const close = () => onClose({ restoreFocus: true });
  const activate = (e: Item) => {
    if (e.disabled) return;
    if (e.confirm) {
      setConfirming(e);
      return;
    }
    close();
    e.onSelect();
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      if (confirming) setConfirming(null);
      else close();
      return;
    }
    if (ev.key === "Tab") {
      ev.preventDefault();
      close();
      return;
    }
    if (confirming) return;
    const cur = itemRefs.current.findIndex((el) => el === document.activeElement);
    const step =
      ev.key === "ArrowDown" ? 1
      : ev.key === "ArrowUp" ? -1
      : ev.key === "Home" ? "first"
      : ev.key === "End" ? "last"
      : null;
    if (step === null) return;
    ev.preventDefault();
    const next = nextEnabledIndex(disabled, cur < 0 ? -1 : cur, step);
    if (next >= 0) itemRefs.current[next]?.focus();
  };

  let ai = -1;
  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{
        position: "fixed",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
      className="theme-panel z-50 min-w-44 max-w-72 border border-border bg-bg-card p-1 text-sm shadow-lg outline-none"
    >
      {confirming ? (
        <div className="space-y-2 p-2" role="group" aria-label={confirming.confirm!.prompt}>
          <p className="text-fg">{confirming.confirm!.prompt}</p>
          <div className="flex gap-2">
            <button
              data-confirm
              onClick={() => {
                const e = confirming;
                close();
                e.onSelect();
              }}
              className="rounded bg-red-600 px-2.5 py-1 text-white hover:bg-red-700"
            >
              {confirming.confirm!.confirmLabel}
            </button>
            <button
              onClick={() => setConfirming(null)}
              className="rounded px-2.5 py-1 text-fg-muted hover:bg-bg-soft hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        items.map((e, i) => {
          if (e.kind === "separator")
            return <div key={`sep-${i}`} role="separator" className="my-1 border-t border-border" />;
          const idx = ++ai;
          return (
            <button
              key={`${e.label}-${i}`}
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
              role="menuitem"
              tabIndex={-1}
              disabled={e.disabled}
              aria-disabled={e.disabled || undefined}
              onClick={() => activate(e)}
              className={`block w-full rounded px-2.5 py-1.5 text-left outline-none disabled:cursor-default disabled:opacity-40 ${
                e.danger
                  ? "text-red-600 hover:bg-red-50 focus:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 dark:focus:bg-red-950"
                  : "text-fg-muted hover:bg-bg-soft hover:text-fg focus:bg-bg-soft focus:text-fg"
              }`}
            >
              {e.label}
            </button>
          );
        })
      )}
    </div>,
    document.body
  );
}
