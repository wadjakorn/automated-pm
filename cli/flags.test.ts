import { describe, it, expect } from "vitest";
import { bareValueFlag, parseFlags, suggest } from "./pm";

describe("parseFlags", () => {
  it("reads --key value and --key=value", () => {
    expect(parseFlags(["--title", "Fix it", "--priority=high"])).toEqual({
      title: "Fix it",
      priority: "high",
    });
  });

  it("lets the = form carry a value that starts with --", () => {
    expect(parseFlags(["--title=--draft--"]).title).toBe("--draft--");
  });

  it("treats a flag followed by another flag as bare", () => {
    expect(parseFlags(["--title", "--priority", "low"])).toEqual({ title: true, priority: "low" });
  });
});

describe("bareValueFlag", () => {
  it("flags a value flag given without a value", () => {
    expect(bareValueFlag(parseFlags(["--id", "PM-1", "--title"]))).toBe("title");
  });

  it("allows real switches", () => {
    expect(bareValueFlag(parseFlags(["--stdin", "--include-deleted", "--unassign", "--confirm"]))).toBeUndefined();
  });
});

describe("suggest", () => {
  it("offers the closest known commands", () => {
    expect(suggest("task lst")).toContain("task list");
    expect(suggest("projct list")).toContain("project list");
  });

  it("offers nothing for gibberish", () => {
    expect(suggest("zzzz qqqq")).toEqual([]);
  });
});
