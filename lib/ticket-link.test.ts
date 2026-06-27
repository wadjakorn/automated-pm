import { describe, it, expect } from "vitest";
import {
  shareLink,
  resolveTicketAction,
  parseTicketRef,
  edgeFromOption,
  linkLabel,
} from "./ticket-link";
import type { Task } from "./types";

const t = (id: string): Task => ({
  id,
  project_id: "p",
  title: id,
  description: null,
  status_key: "todo",
  priority: "medium",
  rank: 1,
  version: 1,
  created_at: "",
  updated_at: "",
  deleted_at: null,
  creator_id: null,
  assignee_id: null,
  creator_username: null,
  assignee_username: null,
});

describe("shareLink", () => {
  it("builds a task-only link", () => {
    expect(shareLink("https://h", "abc")).toBe("https://h/?task=abc");
  });
});

describe("resolveTicketAction", () => {
  it("no param + something open → close", () => {
    expect(resolveTicketAction(null, [], "x")).toEqual({ kind: "close" });
  });
  it("no param + nothing open → noop", () => {
    expect(resolveTicketAction(null, [], null)).toEqual({ kind: "noop" });
  });
  it("param already open → noop", () => {
    expect(resolveTicketAction("a", [t("a")], "a")).toEqual({ kind: "noop" });
  });
  it("param in the loaded list → open-local with that task", () => {
    const task = t("a");
    expect(resolveTicketAction("a", [task], null)).toEqual({ kind: "open-local", task });
  });
  it("param not in the loaded list → fetch", () => {
    expect(resolveTicketAction("z", [t("a")], null)).toEqual({ kind: "fetch" });
  });
});

describe("parseTicketRef", () => {
  it("pulls the id out of a full share URL", () => {
    expect(parseTicketRef("http://dietpi:3000/?project=p1&task=ZExguN2X485E")).toBe(
      "ZExguN2X485E"
    );
  });
  it("accepts a bare id", () => {
    expect(parseTicketRef("  ZExguN2X485E ")).toBe("ZExguN2X485E");
  });
  it("rejects junk with no task param", () => {
    expect(parseTicketRef("https://example.com/foo")).toBeNull();
    expect(parseTicketRef("")).toBeNull();
  });
});

describe("edgeFromOption", () => {
  it("blocked-by flips source/target so it reads as 'other blocks this'", () => {
    expect(edgeFromOption("A", "B", "blocked-by")).toEqual({
      sourceId: "B",
      targetId: "A",
      verb: "blocks",
    });
  });
  it("blocks keeps this as source", () => {
    expect(edgeFromOption("A", "B", "blocks")).toEqual({
      sourceId: "A",
      targetId: "B",
      verb: "blocks",
    });
  });
  it("relates normalizes id order both ways → same row", () => {
    expect(edgeFromOption("B", "A", "relates")).toEqual(
      edgeFromOption("A", "B", "relates")
    );
    expect(edgeFromOption("B", "A", "relates")).toEqual({
      sourceId: "A",
      targetId: "B",
      verb: "relates",
    });
  });
});

describe("linkLabel", () => {
  it("derives the inverse label from the viewer's side", () => {
    expect(linkLabel("blocks", true)).toBe("Blocks");
    expect(linkLabel("blocks", false)).toBe("Blocked by");
    expect(linkLabel("relates", true)).toBe("Relates to");
    expect(linkLabel("relates", false)).toBe("Relates to");
  });
});
