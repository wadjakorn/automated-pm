import { describe, expect, it } from "vitest";
import type { Project } from "@/lib/types";
import {
  dropOnto,
  railLabels,
  rovingTarget,
  actionFailed,
  moveAvailability,
  moveVisible,
  neighbourAfterRemoval,
  orderForDisplay,
  stillShown,
} from "./sidebar-logic";

function project(id: string, hidden = false): Project {
  return {
    id,
    name: id,
    description: null,
    remote_repo_url: null,
    default_status_key: null,
    ready_status_key: null,
    theme_pack: null,
    theme_accent: null,
    ticket_prefix: null,
    sort_order: 0,
    hidden,
    created_at: "",
    updated_at: "",
    deleted_at: null,
    archived_at: null,
  };
}

describe("orderForDisplay", () => {
  const list = [project("h1", true), project("a"), project("h2", true), project("b")];

  it("drops hidden projects when the toggle is off", () => {
    expect(orderForDisplay(list, false).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("appends hidden projects after visible ones, each group in input order", () => {
    expect(orderForDisplay(list, true).map((p) => p.id)).toEqual(["a", "b", "h1", "h2"]);
  });
});

describe("moveVisible", () => {
  const full = ["h1", "a", "h2", "b", "c"];
  const visible = ["a", "b", "c"];

  it("moves up past a hidden neighbour, keeping the hidden one in place", () => {
    expect(moveVisible(full, visible, "b", -1)).toEqual(["h1", "b", "a", "h2", "c"]);
  });

  it("moves down past a hidden neighbour", () => {
    expect(moveVisible(full, visible, "a", 1)).toEqual(["h1", "h2", "b", "a", "c"]);
  });

  it("returns null at the first shown row even when a hidden row precedes it", () => {
    expect(moveVisible(full, visible, "a", -1)).toBeNull();
  });

  it("returns null at the last shown row", () => {
    expect(moveVisible(full, visible, "c", 1)).toBeNull();
  });

  it("moves to top before the first group member", () => {
    expect(moveVisible(full, visible, "c", "top")).toEqual(["h1", "c", "a", "h2", "b"]);
  });

  it("moves to bottom after the last group member", () => {
    expect(moveVisible(full, visible, "a", "bottom")).toEqual(["h1", "h2", "b", "c", "a"]);
  });

  it("returns null for top/bottom when already there", () => {
    expect(moveVisible(full, visible, "a", "top")).toBeNull();
    expect(moveVisible(full, visible, "c", "bottom")).toBeNull();
  });

  it("hidden group move leaves visible order untouched", () => {
    expect(moveVisible(["a", "h1", "b", "h2"], ["h1", "h2"], "h2", -1)).toEqual([
      "a",
      "h2",
      "h1",
      "b",
    ]);
  });

  it("returns null for an id outside the group or the full list", () => {
    expect(moveVisible(full, visible, "h1", 1)).toBeNull();
    expect(moveVisible(full, visible, "zzz", 1)).toBeNull();
  });

  it("does not mutate its inputs", () => {
    const f = full.slice();
    const g = visible.slice();
    moveVisible(f, g, "b", -1);
    expect(f).toEqual(full);
    expect(g).toEqual(visible);
  });
});

describe("neighbourAfterRemoval", () => {
  it("prefers the previous row", () => {
    expect(neighbourAfterRemoval(["a", "b", "c"], "b")).toBe("a");
  });

  it("falls back to the next row at the top", () => {
    expect(neighbourAfterRemoval(["a", "b", "c"], "a")).toBe("b");
  });

  it("returns null when nothing else is shown", () => {
    expect(neighbourAfterRemoval(["a"], "a")).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(neighbourAfterRemoval(["a", "b"], "x")).toBeNull();
  });
});

describe("actionFailed", () => {
  it("formats a readable sentence", () => {
    expect(actionFailed("hide", "capz")).toBe('Couldn\'t hide "capz". Try again.');
  });
});

describe("stillShown", () => {
  const list = [project("a"), project("b"), project("h1", true)];
  it("a project hidden while the toggle is on stays in the list", () => {
    expect(stillShown(list, "a", true, true)).toBe(true);
  });
  it("a project hidden while the toggle is off leaves the list", () => {
    expect(stillShown(list, "a", true, false)).toBe(false);
  });
  it("an unhidden project is shown either way", () => {
    expect(stillShown(list, "h1", false, false)).toBe(true);
  });
});

describe("moveAvailability", () => {
  it("first row can only go down", () => {
    expect(moveAvailability(0, 3)).toEqual({ top: false, up: false, down: true, bottom: true });
  });
  it("last row can only go up", () => {
    expect(moveAvailability(2, 3)).toEqual({ top: true, up: true, down: false, bottom: false });
  });
  it("single row cannot move", () => {
    expect(moveAvailability(0, 1)).toEqual({ top: false, up: false, down: false, bottom: false });
  });
  it("a row missing from its group cannot move", () => {
    expect(moveAvailability(-1, 3)).toEqual({ top: false, up: false, down: false, bottom: false });
  });
});

describe("dropOnto", () => {
  const full = ["h1", "a", "h2", "b", "c"];
  const visible = ["a", "b", "c"];

  it("dragging down lands after the row dropped on", () => {
    expect(dropOnto(full, visible, "a", "c")).toEqual(["h1", "h2", "b", "c", "a"]);
  });
  it("dragging up lands before the row dropped on", () => {
    expect(dropOnto(full, visible, "c", "a")).toEqual(["h1", "c", "a", "h2", "b"]);
  });
  it("is a no-op on itself or onto another group", () => {
    expect(dropOnto(full, visible, "a", "a")).toBeNull();
    expect(dropOnto(full, visible, "a", "h2")).toBeNull();
    expect(dropOnto(full, visible, "a", null)).toBeNull();
  });
});

describe("rovingTarget", () => {
  const names = ["capz", "automated-pm", "Clipz", "viditor"];

  it("arrows step and stop at the ends", () => {
    expect(rovingTarget(names, 1, "ArrowDown")).toBe(2);
    expect(rovingTarget(names, 3, "ArrowDown")).toBe(3);
    expect(rovingTarget(names, 0, "ArrowUp")).toBe(0);
  });
  it("Home / End jump to the ends", () => {
    expect(rovingTarget(names, 2, "Home")).toBe(0);
    expect(rovingTarget(names, 0, "End")).toBe(3);
  });
  it("type-ahead finds the next name starting with the letter, wrapping, case-insensitive", () => {
    expect(rovingTarget(names, 0, "c")).toBe(2);
    expect(rovingTarget(names, 2, "C")).toBe(0);
    expect(rovingTarget(names, 0, "v")).toBe(3);
  });
  it("returns null for other keys or no match", () => {
    expect(rovingTarget(names, 0, "x")).toBeNull();
    expect(rovingTarget(names, 0, "Enter")).toBeNull();
    expect(rovingTarget([], -1, "ArrowDown")).toBeNull();
  });
});

describe("railLabels", () => {
  const p = (id: string, name: string, ticket_prefix: string | null) => ({ id, name, ticket_prefix });

  it("uses the ticket prefix (up to 3 chars), else the first 2 letters of the name", () => {
    expect(railLabels([p("a", "capz", "CP"), p("b", "n8n-feed", "N8NX"), p("c", "viditor", null)])).toEqual({
      a: "CP",
      b: "N8N",
      c: "VI",
    });
  });
  it("widens colliding name-based labels to 3 letters", () => {
    expect(railLabels([p("a", "capz", null), p("b", "capture", null)])).toEqual({ a: "CAP", b: "CAP" });
    expect(railLabels([p("a", "clipz", null), p("b", "content", null), p("c", "cart", null)])).toEqual({
      a: "CL",
      b: "CO",
      c: "CA",
    });
    expect(railLabels([p("a", "capz", null), p("b", "cart", null)])).toEqual({ a: "CAP", b: "CAR" });
  });
  it("skips non-alphanumerics and falls back to ?", () => {
    expect(railLabels([p("a", "--x", null), p("b", "!!", null)])).toEqual({ a: "X", b: "?" });
  });
});
