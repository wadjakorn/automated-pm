import { describe, it, expect } from "vitest";
import { markdownToPlainText } from "./markdown";

describe("markdownToPlainText", () => {
  it("drops images and unwraps links/markers", () => {
    expect(markdownToPlainText("hi ![x](/a.png) **bold** [g](/u)")).toBe(
      "hi bold g"
    );
  });
  it("strips headings, lists and code fences", () => {
    expect(markdownToPlainText("# Title\n- one\n- two\n`code`")).toBe(
      "Title one two code"
    );
  });
  it("collapses whitespace and handles empty input", () => {
    expect(markdownToPlainText("")).toBe("");
    expect(markdownToPlainText("a\n\n\nb")).toBe("a b");
  });
  it("flattens GFM tables (no pipes or separator rows)", () => {
    expect(markdownToPlainText("| a | b |\n|---|---|\n| 1 | 2 |")).toBe(
      "a b 1 2"
    );
  });
});
