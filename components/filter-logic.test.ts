import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTER,
  countLabel,
  isFilterActive,
  matchesFilter,
  readFilter,
  writeFilter,
} from "./filter-logic";

const task = (extra: Record<string, unknown> = {}) => ({
  title: "Fix the login page",
  ticket_key: "PM-0012",
  description: "Users see a blank screen after **OAuth**",
  assignee_id: "u1",
  assignee_username: "alice",
  priority: "high" as const,
  ...extra,
});

describe("readFilter / writeFilter", () => {
  it("reads the filter from the URL, dropping an unknown priority", () => {
    expect(readFilter(new URLSearchParams("q=login&assignee=me&priority=now"))).toEqual({
      q: "login",
      assignee: "me",
      priority: "now",
    });
    expect(readFilter(new URLSearchParams("priority=urgent"))).toEqual(EMPTY_FILTER);
  });

  it("writes only non-empty fields and keeps other params", () => {
    const sp = writeFilter("project=p1&task=PM-1&q=old&priority=low", {
      q: "new one",
      assignee: "",
      priority: "",
    });
    expect(sp.get("project")).toBe("p1");
    expect(sp.get("task")).toBe("PM-1");
    expect(sp.get("q")).toBe("new one");
    expect(sp.has("priority")).toBe(false);
    expect(sp.has("assignee")).toBe(false);
  });

  it("round-trips", () => {
    const f = { q: "แก้ bug", assignee: "none", priority: "medium" as const };
    expect(readFilter(writeFilter("", f))).toEqual(f);
  });
});

describe("isFilterActive", () => {
  it("ignores whitespace-only text", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, q: "  " })).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, assignee: "me" })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, priority: "low" })).toBe(true);
  });
});

describe("matchesFilter", () => {
  it("passes everything with an empty filter", () => {
    expect(matchesFilter(task(), EMPTY_FILTER, null)).toBe(true);
  });

  it("matches every text term across title, key and description", () => {
    const f = (q: string) => ({ ...EMPTY_FILTER, q });
    expect(matchesFilter(task(), f("LOGIN"), null)).toBe(true);
    expect(matchesFilter(task(), f("pm-0012"), null)).toBe(true);
    expect(matchesFilter(task(), f("oauth login"), null)).toBe(true);
    expect(matchesFilter(task(), f("oauth signup"), null)).toBe(false);
    expect(matchesFilter(task({ description: null }), f("oauth"), null)).toBe(false);
  });

  it("filters by me / unassigned / a username or id", () => {
    const a = (assignee: string) => ({ ...EMPTY_FILTER, assignee });
    expect(matchesFilter(task(), a("me"), "u1")).toBe(true);
    expect(matchesFilter(task(), a("me"), "u2")).toBe(false);
    expect(matchesFilter(task(), a("me"), null)).toBe(false);
    expect(matchesFilter(task(), a("none"), null)).toBe(false);
    expect(
      matchesFilter(task({ assignee_id: null, assignee_username: null }), a("none"), null)
    ).toBe(true);
    expect(matchesFilter(task(), a("Alice"), null)).toBe(true);
    expect(matchesFilter(task(), a("u1"), null)).toBe(true);
    expect(matchesFilter(task(), a("bob"), null)).toBe(false);
  });

  it("filters by priority", () => {
    expect(matchesFilter(task(), { ...EMPTY_FILTER, priority: "high" }, null)).toBe(true);
    expect(matchesFilter(task(), { ...EMPTY_FILTER, priority: "low" }, null)).toBe(false);
  });
});

describe("countLabel", () => {
  it("shows shown/total only while filtering", () => {
    expect(countLabel(3, 12, true)).toBe("3/12");
    expect(countLabel(12, 12, false)).toBe("12");
  });
});
