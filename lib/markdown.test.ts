import { describe, it, expect } from "vitest";
import { renderMarkdown, safeUrl, markdownToPlainText } from "./markdown";

describe("safeUrl", () => {
  it("allows relative, http(s), mailto, data:image", () => {
    expect(safeUrl("/api/uploads/abc")).toBe("/api/uploads/abc");
    expect(safeUrl("https://x.com/a.png")).toBe("https://x.com/a.png");
    expect(safeUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(safeUrl("data:image/png;base64,AAAA")).toMatch(/^data:image\/png/);
  });
  it("blocks script-bearing schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl(" javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>")).toBeNull();
    expect(safeUrl("vbscript:msgbox")).toBeNull();
  });
});

describe("renderMarkdown — XSS safety", () => {
  it("escapes raw HTML", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("neutralizes javascript: image urls (no tag emitted; left as inert text)", () => {
    const html = renderMarkdown("![x](javascript:alert(1))");
    expect(html).not.toContain("<img"); // no element -> nothing to execute
    expect(html).not.toMatch(/src=/); // and no src attribute carrying the scheme
  });
  it("cannot inject an event handler via the url (quotes escaped, no tag)", () => {
    const html = renderMarkdown('![x](/a.png" onerror="alert(1))');
    // url contains a space -> not matched as an image; stays as escaped text.
    expect(html).not.toContain("<img");
    expect(html).not.toContain('"'); // every real quote is escaped to &quot;
  });
});

describe("renderMarkdown — features", () => {
  it("renders a safe image", () => {
    const html = renderMarkdown("![shot](/api/uploads/abc123)");
    expect(html).toContain('<img src="/api/uploads/abc123"');
    expect(html).toContain('alt="shot"');
  });
  it("renders headings, bold, lists, code", () => {
    expect(renderMarkdown("# Title")).toContain("<h1>Title</h1>");
    expect(renderMarkdown("**b**")).toContain("<strong>b</strong>");
    expect(renderMarkdown("- a\n- b")).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(renderMarkdown("`x`")).toContain("<code>x</code>");
  });
  it("renders fenced code blocks literally", () => {
    const html = renderMarkdown("```\n<b>not bold</b>\n```");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("&lt;b&gt;not bold");
  });
});

describe("markdownToPlainText", () => {
  it("drops images and unwraps links/markers", () => {
    expect(markdownToPlainText("hi ![x](/a.png) **bold** [g](/u)")).toBe(
      "hi bold g"
    );
  });
});
