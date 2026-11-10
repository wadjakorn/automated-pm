import { describe, expect, it } from "vitest";
import { headerContext } from "./nav-logic";

const p = (id: string, name: string, ticket_prefix: string | null = null) =>
  ({ id, name, ticket_prefix }) as any;

describe("headerContext", () => {
  const projects = [p("a", "automated-pm", "PM"), p("b", "capz")];

  it("shows the selected project's name and prefix on project pages", () => {
    expect(headerContext(projects, "a", "/settings")).toEqual({
      kind: "project",
      title: "automated-pm",
      prefix: "PM",
    });
  });

  it("omits a missing prefix", () => {
    expect(headerContext(projects, "b", "/")).toEqual({ kind: "project", title: "capz", prefix: null });
  });

  it("shows the page title on cross-project pages, keeping the selection untouched", () => {
    expect(headerContext(projects, "a", "/home")).toEqual({ kind: "global", title: "My work", prefix: null });
    expect(headerContext(projects, "a", "/inbox")).toEqual({ kind: "global", title: "Inbox", prefix: null });
  });

  it("has no title while projects are loading or none is selected", () => {
    expect(headerContext([], null, "/")).toEqual({ kind: "project", title: null, prefix: null });
    expect(headerContext(projects, "zzz", "/")).toEqual({ kind: "project", title: null, prefix: null });
  });
});
