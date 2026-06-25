import { describe, it, expect } from "vitest";
import { render, renderError, table } from "./render";

const pretty = { mode: "pretty" as const, color: false };
const json = { mode: "json" as const, color: false };

describe("table", () => {
  it("pads columns to the widest cell", () => {
    const out = table(["A", "BB"], [["xx", "y"], ["z", "wwww"]]);
    expect(out.split("\n")).toEqual(["A   BB", "xx  y", "z   wwww"]);
  });
});

describe("render json passthrough", () => {
  it("returns exact JSON regardless of kind", () => {
    const data = { a: 1 };
    expect(render("project", data, json)).toBe(JSON.stringify(data, null, 2));
  });
});

describe("render pretty", () => {
  it("projects → table with header", () => {
    const out = render("projects", [{ id: "p1", name: "Demo", description: null, created_at: "2026-01-02T00:00:00Z" }], pretty);
    expect(out).toContain("ID");
    expect(out).toContain("p1");
    expect(out).toContain("Demo");
    expect(out).toContain("2026-01-02");
  });

  it("empty projects → placeholder", () => {
    expect(render("projects", [], pretty)).toBe("(no projects)");
  });

  it("single project → confirmation", () => {
    expect(render("project", { id: "p1", name: "Demo" }, pretty)).toBe('✓ project Demo (p1)');
  });

  it("single task → arrow confirmation", () => {
    expect(render("task", { id: "t1", title: "Wire it", status_key: "doing", version: 3 }, pretty))
      .toBe('✓ t1 "Wire it" → doing (v3)');
  });

  it("tasks → table", () => {
    const out = render("tasks", [{ id: "t1", status_key: "todo", title: "Hi", version: 1 }], pretty);
    expect(out).toContain("STATUS");
    expect(out).toContain("t1");
    expect(out).toContain("todo");
    expect(out).toContain("v1");
  });

  it("ok → done line", () => {
    expect(render("ok", { ok: true }, pretty)).toBe("✓ done");
  });
});

describe("renderError", () => {
  it("json mode returns the raw error payload", () => {
    const e = { error: "not_found", message: "task not found" };
    expect(renderError(e, json)).toBe(JSON.stringify(e, null, 2));
  });

  it("pretty mode prints code + message + hint", () => {
    const out = renderError({ error: "illegal_transition", message: "no edge" }, pretty);
    expect(out).toContain("✗ illegal_transition: no edge");
    expect(out).toContain("pm status list");
  });

  it("conflict hint mentions version", () => {
    expect(renderError({ error: "conflict", message: "stale" }, pretty)).toContain("version");
  });
});

describe("render board", () => {
  it("renders one block per column with task bullets", () => {
    const data = {
      columns: [
        { status: { key: "todo", label: "To Do" }, tasks: [{ id: "t1", title: "A" }] },
        { status: { key: "doing", label: "Doing" }, tasks: [] },
      ],
    };
    const out = render("board", data, pretty);
    expect(out).toContain("To Do (1)");
    expect(out).toContain("• A");
    expect(out).toContain("t1");
    expect(out).toContain("Doing (0)");
    expect(out).toContain("(empty)");
  });
});
