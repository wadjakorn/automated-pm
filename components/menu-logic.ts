// Pure helpers for the popover Menu (components/Menu.tsx): keyboard roving
// over enabled items and viewport-aware placement next to the trigger.

// Index of the next enabled item. `step` 1/-1 moves from `from` and wraps;
// "first"/"last" ignore `from`. Returns -1 when no item is enabled.
export function nextEnabledIndex(
  disabled: boolean[],
  from: number,
  step: 1 | -1 | "first" | "last"
): number {
  const n = disabled.length;
  if (n === 0) return -1;
  if (step === "first") return disabled.findIndex((d) => !d);
  if (step === "last") {
    for (let i = n - 1; i >= 0; i--) if (!disabled[i]) return i;
    return -1;
  }
  for (let k = 1; k <= n; k++) {
    const i = (((from + step * k) % n) + n) % n;
    if (!disabled[i]) return i;
  }
  return -1;
}

type Rect = { top: number; bottom: number; left: number; right: number };
type Size = { width: number; height: number };

const GAP = 4;
const MARGIN = 8;

// Fixed-position coordinates for a menu anchored to a trigger: below it by
// default, above it when it does not fit below and there is more room above,
// aligned to the trigger's left ("start") or right ("end") edge, and always
// clamped inside the viewport.
export function placeMenu(
  anchor: Rect,
  menu: Size,
  viewport: Size,
  align: "start" | "end"
): { top: number; left: number } {
  const below = viewport.height - anchor.bottom;
  const above = anchor.top;
  const flip = below < menu.height + GAP && above > below;
  const top = flip ? anchor.top - GAP - menu.height : anchor.bottom + GAP;
  const left = align === "start" ? anchor.left : anchor.right - menu.width;
  const clamp = (v: number, max: number) => Math.max(MARGIN, Math.min(v, max));
  return {
    top: clamp(top, viewport.height - menu.height - MARGIN),
    left: clamp(left, viewport.width - menu.width - MARGIN),
  };
}

export type MenuKeyAction =
  | "pass"
  | "swallow"
  | "close"
  | "back"
  | { step: 1 | -1 | "first" | "last" };

// What a keydown inside the menu means. Auto-repeated Enter/Space are
// swallowed so holding the key that opened the confirm view can't also
// confirm it; a fresh Enter/Space passes through to the focused button.
export function menuKeyAction(e: {
  key: string;
  repeat: boolean;
  confirming: boolean;
}): MenuKeyAction {
  if ((e.key === "Enter" || e.key === " ") && e.repeat) return "swallow";
  if (e.key === "Escape") return e.confirming ? "back" : "close";
  if (e.key === "Tab") return "close";
  if (e.confirming) return "pass";
  if (e.key === "ArrowDown") return { step: 1 };
  if (e.key === "ArrowUp") return { step: -1 };
  if (e.key === "Home") return { step: "first" };
  if (e.key === "End") return { step: "last" };
  return "pass";
}
