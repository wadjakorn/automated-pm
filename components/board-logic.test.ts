import { describe, expect, it } from "vitest";
import type { Project } from "@/lib/types";
import { buildDefaultStateMachine } from "@/lib/statemachine";
import {
  canUndoMove,
  dropHint,
  neighbourColumnX,
  pickDefaultProject,
} from "./board-logic";

const sm = buildDefaultStateMachine("p1");

function project(id: string, extra: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    description: null,
    remote_repo_url: null,
    default_status_key: null,
    ready_status_key: null,
    theme_pack: null,
    theme_accent: null,
    ticket_prefix: null,
    sort_order: 0,
    hidden: false,
    created_at: "",
    updated_at: "",
    deleted_at: null,
    archived_at: null,
    ...extra,
  };
}

describe("dropHint", () => {
  it("marks the source column as same", () => {
    expect(dropHint(sm, "todo", "todo")).toBe("same");
  });
  it("marks one-step transitions as legal", () => {
    expect(dropHint(sm, "todo", "doing")).toBe("legal");
  });
  it("marks everything else as illegal", () => {
    expect(dropHint(sm, "todo", "released")).toBe("illegal");
    expect(dropHint(sm, "todo", "backlog")).toBe("illegal");
  });
  it("treats every other column as illegal from a final status", () => {
    expect(dropHint(sm, "released", "tested")).toBe("illegal");
  });
});

describe("canUndoMove", () => {
  it("is false when the reverse edge is missing (default linear chain)", () => {
    expect(canUndoMove(sm, "todo", "doing")).toBe(false);
  });
  it("is true when the reverse edge exists", () => {
    const withBack = {
      ...sm,
      transitions: [
        ...sm.transitions,
        { id: "x", project_id: "p1", from_key: "doing", to_key: "todo" },
      ],
    };
    expect(canUndoMove(withBack, "todo", "doing")).toBe(true);
  });
});

describe("pickDefaultProject", () => {
  it("returns null with no projects", () => {
    expect(pickDefaultProject([], "a")).toBeNull();
  });
  it("prefers the last-selected project when still selectable", () => {
    expect(pickDefaultProject([project("a"), project("b")], "b")).toBe("b");
  });
  it("skips a hidden first project", () => {
    expect(pickDefaultProject([project("a", { hidden: true }), project("b")], null)).toBe(
      "b"
    );
  });
  it("ignores a last-selected project that is hidden, archived or gone", () => {
    const ps = [project("a"), project("h", { hidden: true }), project("r", { archived_at: "x" })];
    expect(pickDefaultProject(ps, "h")).toBe("a");
    expect(pickDefaultProject(ps, "r")).toBe("a");
    expect(pickDefaultProject(ps, "gone")).toBe("a");
  });
  it("falls back to the first project when all are hidden", () => {
    expect(pickDefaultProject([project("a", { hidden: true })], null)).toBe("a");
  });
});

describe("neighbourColumnX", () => {
  const cols = [
    { left: 300, width: 200 },
    { left: 0, width: 200 },
    { left: 600, width: 200 },
  ];
  it("centers the card in the next column to the right", () => {
    expect(neighbourColumnX(cols, 100, 100, 1)).toBe(350);
  });
  it("centers the card in the previous column to the left", () => {
    expect(neighbourColumnX(cols, 700, 100, -1)).toBe(350);
  });
  it("returns null past either end", () => {
    expect(neighbourColumnX(cols, 100, 100, -1)).toBeNull();
    expect(neighbourColumnX(cols, 700, 100, 1)).toBeNull();
  });
  it("uses the nearest column when the card sits in a gap", () => {
    expect(neighbourColumnX(cols, 260, 100, 1)).toBe(650);
  });
});
