import { describe, expect, it } from "vitest";
import { paletteActions, parseSnippet, splitActions, ticketHref } from "./search-logic";

describe("parseSnippet", () => {
  it("returns nothing for null/empty", () => {
    expect(parseSnippet(null)).toEqual([]);
    expect(parseSnippet("")).toEqual([]);
  });

  it("splits bracketed hits from plain text", () => {
    expect(parseSnippet("…fix the [login] page")).toEqual([
      { text: "…fix the ", hit: false },
      { text: "login", hit: true },
      { text: " page", hit: false },
    ]);
  });

  it("handles several hits, a hit at the start and Thai text", () => {
    expect(parseSnippet("[แก้]ไข [bug] now")).toEqual([
      { text: "แก้", hit: true },
      { text: "ไข ", hit: false },
      { text: "bug", hit: true },
      { text: " now", hit: false },
    ]);
  });

  it("keeps unmatched brackets literal", () => {
    expect(parseSnippet("a [b] c [d")).toEqual([
      { text: "a ", hit: false },
      { text: "b", hit: true },
      { text: " c [d", hit: false },
    ]);
    expect(parseSnippet("x ] y")).toEqual([{ text: "x ] y", hit: false }]);
    expect(parseSnippet("a [] b")).toEqual([{ text: "a [] b", hit: false }]);
  });

  it("with a query, keeps brackets that are part of the text literal", () => {
    expect(parseSnippet("[bug] scroll [capture] inclu…", "capture")).toEqual([
      { text: "[bug] scroll ", hit: false },
      { text: "capture", hit: true },
      { text: " inclu…", hit: false },
    ]);
    // partial-word marks (the server may highlight a fragment) still count
    expect(parseSnippet("tighten relevance for [sear]…", "search")).toEqual([
      { text: "tighten relevance for ", hit: false },
      { text: "sear", hit: true },
      { text: "…", hit: false },
    ]);
    expect(parseSnippet("[Zoom]/[pan] must", "ZOOM pan")).toEqual([
      { text: "Zoom", hit: true },
      { text: "/", hit: false },
      { text: "pan", hit: true },
      { text: " must", hit: false },
    ]);
  });

  it("merges adjacent hits", () => {
    expect(parseSnippet("[foo][bar]")).toEqual([{ text: "foobar", hit: true }]);
  });
});

describe("ticketHref", () => {
  it("prefers the ticket key and falls back to the id", () => {
    expect(ticketHref({ project_id: "p1", id: "abc", ticket_key: "PM-0002" })).toBe(
      "/?project=p1&task=PM-0002"
    );
    expect(ticketHref({ project_id: "p1", id: "abc", ticket_key: null })).toBe(
      "/?project=p1&task=abc"
    );
  });
});

describe("paletteActions", () => {
  const projects = [
    { id: "a", name: "Website" },
    { id: "b", name: "Automated PM" },
    { id: "c", name: "PM tools" },
  ];
  const current = projects[1];

  it("lists every project and the nav pages for an empty query, no create", () => {
    const acts = paletteActions("", { projects, currentProject: current });
    expect(acts.map((a) => a.label)).toEqual([
      "Go to Website",
      "Go to Automated PM",
      "Go to PM tools",
      "My work",
      "Inbox",
    ]);
  });

  it("matches project names case-insensitively, prefix matches first", () => {
    const acts = paletteActions("pm", { projects, currentProject: current });
    expect(acts.filter((a) => a.kind === "project").map((a) => a.label)).toEqual([
      "Go to PM tools",
      "Go to Automated PM",
    ]);
  });

  it("offers the nav pages by name", () => {
    expect(
      paletteActions("inb", { projects, currentProject: null }).map((a) => a.label)
    ).toEqual(["Inbox"]);
    expect(
      paletteActions("my work", { projects, currentProject: null }).map((a) => a.label)
    ).toEqual(["My work"]);
  });

  it("offers a new ticket in the current project with the typed title", () => {
    const acts = paletteActions("  Fix login  ", { projects, currentProject: current });
    const create = acts.find((a) => a.kind === "new-ticket");
    expect(create).toEqual({
      kind: "new-ticket",
      id: "new-ticket",
      label: "New ticket in Automated PM",
      projectId: "b",
      title: "Fix login",
    });
    expect(acts[acts.length - 1]).toBe(create);
  });

  it("offers no create without a current project", () => {
    expect(
      paletteActions("Fix", { projects, currentProject: null }).some((a) => a.kind === "new-ticket")
    ).toBe(false);
  });

  it("puts prefix-matching projects ahead of the hits, the rest after", () => {
    const acts = paletteActions("pm", { projects, currentProject: current });
    const { lead, rest } = splitActions(acts, "pm", projects);
    expect(lead.map((a) => a.label)).toEqual(["Go to PM tools"]);
    expect(rest.map((a) => a.label)).toEqual(["Go to Automated PM", "New ticket in Automated PM"]);
    expect(splitActions(paletteActions("", { projects, currentProject: null }), "", projects).lead).toEqual([]);
  });

  it("caps the project list", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `Proj ${i}` }));
    expect(
      paletteActions("proj", { projects: many, currentProject: null }).filter(
        (a) => a.kind === "project"
      )
    ).toHaveLength(6);
  });
});
