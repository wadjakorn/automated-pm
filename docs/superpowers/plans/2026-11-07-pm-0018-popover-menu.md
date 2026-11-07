# PM-0018 Popover Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One accessible popover menu component that replaces the sidebar row's ⋯ accordion and the header's raw `<details>` "Project" menu.

**Architecture:** Pure placement + keyboard math in `components/menu-logic.ts` (vitest, node env). `components/Menu.tsx` renders a `role="menu"` portal into `document.body` with `position: fixed` (the sidebar's `.theme-nav` has `backdrop-filter`, which would trap a fixed child; theme vars live on `:root`, so the portal keeps theming). Sidebar and Nav own their trigger buttons and pass items.

**Tech Stack:** React 19, `react-dom` `createPortal`, Tailwind 3.4, vitest.

**Spec:** `docs/superpowers/specs/2026-11-06-sidebar-topbar-v2-design.md` §3.3 (ticket PM-0018)

## Global Constraints

- Menu closes on Esc, outside pointerdown, item select, Tab, window resize, and scroll outside the menu; Esc/select/Tab return focus to the trigger; outside click does not steal focus.
- Keyboard inside the menu: ↑/↓ wrap over enabled items, Home/End, Enter/Space activate. The first enabled item is focused on open.
- Trigger: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls` while open. Items: `role="menuitem"`; separators `role="separator"`.
- `z-50` (above the mobile drawer's `z-40`). Styles: `theme-panel border border-border bg-bg-card` + existing tokens only.
- Sidebar row items, in order: Move to top · Move up · Move down · Move to bottom — Settings · Appearance — Hide from sidebar / Show in sidebar · Archive — Move to Trash… (danger). Move items disabled at the edges of the row's display group.
- "Move to Trash…" switches the open menu to a confirm view: text `Move "<name>" to Trash?`, buttons `Move to Trash` (danger, focused) and `Cancel` (back to the list). No `window.confirm` left in `Sidebar.tsx`.
- ⋯ visible always on touch (`hover: none`), on pointer devices only on row hover / focus-within / active row / menu open.
- Row right-click, and `ContextMenu` / `Shift+F10` on the focused project button, open the same menu.
- Header: "Project ▾" button + menu (Settings · Appearance — Archive · Trash) as navigation items carrying `?project=`. Label/icon change is PM-0024, not here.

## Review Focus

1. Opening a menu on a row near the bottom of a scrolled list must open upward and stay inside the viewport → Task 1 `placeMenu` flip + clamp tests.
2. All items disabled except one: arrows must not get stuck or land on a disabled item → Task 1 `nextEnabledIndex` tests.
3. Esc inside a menu inside the mobile drawer must close only the menu, not the drawer → Task 2 (`preventDefault` before the drawer's document listener, which already checks `defaultPrevented`); verified in Task 4.
4. A move at the group edge is unavailable from the menu → Task 1 `moveAvailability` tests; Task 3 uses it.
5. Trash confirm must not fire on the first click → Task 3; verified in Task 4.

---

### Task 1: Pure menu logic

**Files:** Create `components/menu-logic.ts`, `components/menu-logic.test.ts`; Modify `components/sidebar-logic.ts`, `components/sidebar-logic.test.ts`

**Produces:**
- `nextEnabledIndex(disabled: boolean[], from: number, step: 1 | -1 | "first" | "last"): number` — wraps; `-1` when nothing is enabled.
- `placeMenu(anchor: {top,bottom,left,right}, menu: {width,height}, viewport: {width,height}, align: "start" | "end"): {top: number; left: number}` — below the anchor with a 4px gap; above it when the space below is less than `menu.height + 4` and the space above is larger; `left` = `anchor.left` (start) or `anchor.right - menu.width` (end); both clamped to an 8px viewport margin.
- `moveAvailability(index: number, length: number): { top: boolean; up: boolean; down: boolean; bottom: boolean }` in `sidebar-logic.ts` — `true` means available.

- [ ] Tests (names): "skips disabled items going down", "wraps from last to first", "first/last pick the first/last enabled", "returns -1 when all disabled"; "opens below by default", "flips above near the bottom", "aligns end to the anchor's right edge", "clamps to the viewport margin"; "first row can only go down", "last row can only go up", "single row cannot move".
- [ ] Run `npx vitest run components/menu-logic.test.ts components/sidebar-logic.test.ts` → FAIL (missing exports), implement, → PASS. Commit.

### Task 2: `components/Menu.tsx`

**Produces:** `type MenuEntry = { kind: "item"; label: string; onSelect: () => void; disabled?: boolean; danger?: boolean; confirm?: { prompt: string; confirmLabel: string } } | { kind: "separator" }`; `function Menu(props: { open: boolean; onClose: (opts?: { restoreFocus?: boolean }) => void; anchorRef: React.RefObject<HTMLElement | null>; items: MenuEntry[]; align?: "start" | "end"; label: string; id: string }): JSX.Element | null`.

- [ ] Implement with Task 1 functions; `useLayoutEffect` measures and places; a confirm entry swaps the list for the confirm view. `npx tsc --noEmit` clean. Commit with Task 3.

### Task 3: Wire Sidebar and Nav

- [ ] Sidebar: replace the accordion + `MenuBtn` with ⋯ trigger + `<Menu>`; `menuFor` stays the open-row id; add `moveTo(p, "top" | "bottom")`; `del` drops `window.confirm`; Settings/Appearance push `/settings?project=<id>` / `/appearance?project=<id>`; ⋯ visibility classes; `onContextMenu` + key handler on the row.
- [ ] Nav: replace `<details>` with a button + `<Menu align="end">` of navigation items; keep `projectMenuActive` styling; add `▾`.
- [ ] `npx tsc --noEmit && npm test` green. Commit.

### Task 4: Verify in the built app, PR

- [ ] Build, run on port 3005 with a copy of `data/pm.db` (`PM_DB_PATH`), temp session for `uiverify`, Playwright 1440×900 and 390×844: open/close by Esc / outside click / select with focus return; arrows skip disabled; bottom row opens upward and is not clipped; trash needs confirm; Esc in the mobile drawer's menu leaves the drawer open; ⋯ hidden until hover on desktop; header Project menu closes on Esc/outside click.
- [ ] Clean up server + db copy; push; PR; comment on PM-0018; move to completed.
