import { describe, it, expect } from "vitest";
import { shareLink, resolveTicketAction } from "./ticket-link";
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
