import { describe, it, expect } from "vitest";
import {
  shareLink,
  ticketRef,
  resolveTicketAction,
  parseTicketRef,
  edgeFromOption,
  linkLabel,
} from "./ticket-link";
import type { Task } from "./types";

const t = (id: string, ticket_key: string | null = null): Task => ({
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
  archived_at: null,
  ticket_number: null,
  ticket_key,
  creator_id: null,
  assignee_id: null,
  creator_username: null,
  assignee_username: null,
});

describe("ticketRef", () => {
  it("prefers the human ticket key", () => {
    expect(ticketRef(t("abc", "PM-0002"))).toBe("PM-0002");
  });

  it("falls back to the nanoid when the project has no prefix", () => {
    expect(ticketRef(t("abc"))).toBe("abc");
  });
});

describe("shareLink", () => {
  it("builds a task-only link from the ticket key", () => {
    expect(shareLink("https://h", t("abc", "PM-0002"))).toBe("https://h/?task=PM-0002");
  });

  it("falls back to the id when there is no key", () => {
    expect(shareLink("https://h", t("abc"))).toBe("https://h/?task=abc");
  });
});

describe("resolveTicketAction", () => {
  it("no param + something open → close", () => {
    expect(resolveTicketAction(null, [], t("x"))).toEqual({ kind: "close" });
  });
  it("no param + nothing open → noop", () => {
    expect(resolveTicketAction(null, [], null)).toEqual({ kind: "noop" });
  });
  it("param already open → noop", () => {
    expect(resolveTicketAction("a", [t("a")], t("a"))).toEqual({ kind: "noop" });
  });
  it("param in the loaded list → open-local with that task", () => {
    const task = t("a");
    expect(resolveTicketAction("a", [task], null)).toEqual({ kind: "open-local", task });
  });
  it("param not in the loaded list → fetch", () => {
    expect(resolveTicketAction("z", [t("a")], null)).toEqual({ kind: "fetch" });
  });

  it("matches a loaded task by its ticket key", () => {
    const task = t("a", "PM-0002");
    expect(resolveTicketAction("PM-0002", [task], null)).toEqual({
      kind: "open-local",
      task,
    });
  });

  it("still matches a legacy nanoid param", () => {
    const task = t("a", "PM-0002");
    expect(resolveTicketAction("a", [task], null)).toEqual({
      kind: "open-local",
      task,
    });
  });

  it("prefers a task whose storage id matches over one whose key matches", () => {
    // "AB-00012345" is a possible random id AND a possible ticket key. The
    // ticket that actually owns that id must win, whatever the list order.
    const byId = t("AB-00012345", "ZZ-0009");
    const byKey = t("other", "AB-00012345");
    expect(resolveTicketAction("AB-00012345", [byKey, byId], null)).toEqual({
      kind: "open-local",
      task: byId,
    });
  });

  it("does not noop on a key-shaped id just because the open ticket owns that key", () => {
    // Drawer holds the ticket whose KEY is "AB-00012345"; the URL names the
    // different ticket whose ID is "AB-00012345". Must open, not noop.
    const open = t("other", "AB-00012345");
    const target = t("AB-00012345", "ZZ-0009");
    expect(resolveTicketAction("AB-00012345", [target], open)).toEqual({
      kind: "open-local",
      task: target,
    });
  });

  it("noop when the open ticket is named by key but is NOT in the loaded list", () => {
    // Cold deep link to an archived / cross-project ticket: the drawer holds it
    // but the board's task list does not. Must still be noop, or the effect
    // refetches it forever.
    const task = t("a", "PM-0002");
    expect(resolveTicketAction("PM-0002", [], task)).toEqual({ kind: "noop" });
  });

  it("noop when the already-open ticket is named by its key", () => {
    // Drawer state keys off the storage id, so a key param naming the open
    // ticket must not re-trigger an open (which would loop with the URL rewrite).
    const task = t("a", "PM-0002");
    expect(resolveTicketAction("PM-0002", [task], task)).toEqual({ kind: "noop" });
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
  it("accepts a bare ticket key", () => {
    expect(parseTicketRef(" PM-0002 ")).toBe("PM-0002");
  });

  it("reads a ticket key out of a share URL", () => {
    expect(parseTicketRef("http://dietpi:3000/?task=PM-0002")).toBe("PM-0002");
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
