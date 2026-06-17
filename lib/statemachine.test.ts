import { describe, it, expect } from "vitest";
import {
  DEFAULT_STATUSES,
  DEFAULT_TRANSITIONS,
  canTransition,
  allowedTargets,
  buildDefaultStateMachine,
} from "./statemachine";
import type { StateMachine } from "./types";

const sm: StateMachine = buildDefaultStateMachine("p1");

describe("default state machine", () => {
  it("has the expected ordered statuses", () => {
    expect(DEFAULT_STATUSES.map((s) => s.key)).toEqual([
      "backlog",
      "todo",
      "doing",
      "completed",
      "tested",
      "released",
    ]);
  });

  it("marks released as final and nothing else", () => {
    const finals = DEFAULT_STATUSES.filter((s) => s.is_final).map((s) => s.key);
    expect(finals).toEqual(["released"]);
  });

  it("default transitions form the linear chain", () => {
    expect(DEFAULT_TRANSITIONS).toContainEqual({ from_key: "backlog", to_key: "todo" });
    expect(DEFAULT_TRANSITIONS).toContainEqual({ from_key: "tested", to_key: "released" });
  });

  it("builds a project-scoped state machine with sort_order and ids", () => {
    expect(sm.statuses).toHaveLength(6);
    expect(sm.statuses[0].project_id).toBe("p1");
    expect(sm.statuses.map((s) => s.sort_order)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("canTransition", () => {
  it("allows a legal forward edge", () => {
    expect(canTransition(sm, "backlog", "todo").ok).toBe(true);
    expect(canTransition(sm, "doing", "completed").ok).toBe(true);
  });

  it("rejects a move with no defined edge", () => {
    const r = canTransition(sm, "backlog", "released");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no transition/i);
  });

  it("locks final states (no outbound moves)", () => {
    const r = canTransition(sm, "released", "todo");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/final/i);
  });

  it("treats same-status as a no-op (ok)", () => {
    expect(canTransition(sm, "doing", "doing").ok).toBe(true);
  });

  it("rejects unknown statuses", () => {
    expect(canTransition(sm, "backlog", "ghost").ok).toBe(false);
    expect(canTransition(sm, "ghost", "todo").ok).toBe(false);
  });
});

describe("allowedTargets", () => {
  it("lists reachable statuses from a given status", () => {
    expect(allowedTargets(sm, "doing")).toEqual(["completed"]);
  });

  it("returns empty for a final status", () => {
    expect(allowedTargets(sm, "released")).toEqual([]);
  });
});
