import { describe, expect, it } from "vitest";
import { menuKeyAction, nextEnabledIndex, placeMenu } from "./menu-logic";

describe("nextEnabledIndex", () => {
  const d = [false, true, false, false];

  it("skips disabled items going down", () => {
    expect(nextEnabledIndex(d, 0, 1)).toBe(2);
  });

  it("skips disabled items going up", () => {
    expect(nextEnabledIndex(d, 2, -1)).toBe(0);
  });

  it("wraps from last to first", () => {
    expect(nextEnabledIndex(d, 3, 1)).toBe(0);
  });

  it("wraps from first to last", () => {
    expect(nextEnabledIndex(d, 0, -1)).toBe(3);
  });

  it("first/last pick the first/last enabled", () => {
    expect(nextEnabledIndex([true, false, false, true], -1, "first")).toBe(1);
    expect(nextEnabledIndex([true, false, false, true], -1, "last")).toBe(2);
  });

  it("stays on the only enabled item", () => {
    expect(nextEnabledIndex([true, false, true], 1, 1)).toBe(1);
  });

  it("returns -1 when all disabled", () => {
    expect(nextEnabledIndex([true, true], 0, 1)).toBe(-1);
    expect(nextEnabledIndex([], -1, "first")).toBe(-1);
  });
});

describe("placeMenu", () => {
  const viewport = { width: 1000, height: 800 };
  const menu = { width: 180, height: 300 };

  it("opens below by default", () => {
    const a = { top: 100, bottom: 130, left: 200, right: 230 };
    expect(placeMenu(a, menu, viewport, "start")).toEqual({ top: 134, left: 200 });
  });

  it("flips above near the bottom", () => {
    const a = { top: 700, bottom: 730, left: 200, right: 230 };
    expect(placeMenu(a, menu, viewport, "start")).toEqual({ top: 396, left: 200 });
  });

  it("aligns end to the anchor's right edge", () => {
    const a = { top: 10, bottom: 40, left: 900, right: 960 };
    expect(placeMenu(a, menu, viewport, "end").left).toBe(780);
  });

  it("clamps to the viewport margin", () => {
    const a = { top: 10, bottom: 40, left: 950, right: 990 };
    expect(placeMenu(a, menu, viewport, "start").left).toBe(812);
    const b = { top: 10, bottom: 40, left: 2, right: 30 };
    expect(placeMenu(b, menu, viewport, "end").left).toBe(8);
  });

  it("keeps a too-tall menu inside the viewport", () => {
    const a = { top: 380, bottom: 410, left: 200, right: 230 };
    const tall = { width: 180, height: 900 };
    expect(placeMenu(a, tall, viewport, "start").top).toBe(8);
  });
});

describe("menuKeyAction", () => {
  const k = (key: string, extra: Partial<{ repeat: boolean; confirming: boolean }> = {}) =>
    menuKeyAction({ key, repeat: false, confirming: false, ...extra });

  it("ignores auto-repeated Enter and Space so a held key cannot confirm", () => {
    expect(k("Enter", { repeat: true })).toBe("swallow");
    expect(k(" ", { repeat: true, confirming: true })).toBe("swallow");
  });
  it("lets a fresh Enter through to the focused button", () => {
    expect(k("Enter")).toBe("pass");
  });
  it("Esc closes the list but backs out of the confirm view", () => {
    expect(k("Escape")).toBe("close");
    expect(k("Escape", { confirming: true })).toBe("back");
  });
  it("Tab closes", () => {
    expect(k("Tab")).toBe("close");
  });
  it("maps arrows and Home/End to roving steps, but not in the confirm view", () => {
    expect(k("ArrowDown")).toEqual({ step: 1 });
    expect(k("ArrowUp")).toEqual({ step: -1 });
    expect(k("Home")).toEqual({ step: "first" });
    expect(k("End")).toEqual({ step: "last" });
    expect(k("ArrowDown", { confirming: true })).toBe("pass");
  });
});
