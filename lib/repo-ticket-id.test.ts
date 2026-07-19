import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Throwaway DB before importing the repo (it reads PM_DB_PATH at load time).
let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-tid-")), "test.db");
  repo = await import("./repo");
});

describe("ticket ids (Jira-like)", () => {
  it("assigns a random 2-char prefix to new projects", () => {
    const p = repo.createProject("tid-prefix-default");
    expect(p.ticket_prefix).toMatch(/^[A-Z]{2}$/);
  });

  it("numbers tasks per-project starting at 1, forming PREFIX-NNNN", () => {
    const p = repo.createProject("tid-numbering");
    const prefix = p.ticket_prefix!;
    const a = repo.createTask(p.id, { title: "first" });
    const b = repo.createTask(p.id, { title: "second" });
    expect(a.ticket_number).toBe(1);
    expect(b.ticket_number).toBe(2);
    expect(a.ticket_key).toBe(`${prefix}-0001`);
    expect(b.ticket_key).toBe(`${prefix}-0002`);
  });

  it("numbers independently per project", () => {
    const p1 = repo.createProject("tid-iso-1");
    const p2 = repo.createProject("tid-iso-2");
    repo.createTask(p1.id, { title: "p1-a" });
    const p2a = repo.createTask(p2.id, { title: "p2-a" });
    expect(p2a.ticket_number).toBe(1);
  });

  it("does not reuse a number after a task is deleted", () => {
    const p = repo.createProject("tid-no-reuse");
    const a = repo.createTask(p.id, { title: "a" });
    repo.softDeleteTask(a.id);
    const b = repo.createTask(p.id, { title: "b" });
    // MAX(ticket_number) ignores deleted_at, so numbers never collide.
    expect(b.ticket_number).toBe(2);
  });

  it("keeps the display key stable when the prefix later changes", () => {
    const p = repo.createProject("tid-relabel");
    const t = repo.createTask(p.id, { title: "t" });
    expect(t.ticket_number).toBe(1);
    const u = repo.updateProject(p.id, { ticket_prefix: "ABC" });
    expect(u.ticket_prefix).toBe("ABC");
    // number is stored; the display key is recomputed from the new prefix.
    const reread = repo.getTask(t.id);
    expect(reread.ticket_number).toBe(1);
    expect(reread.ticket_key).toBe("ABC-0001");
  });

  it("changing the prefix is not a guarded edit (no confirm needed)", () => {
    const p = repo.createProject("tid-unguarded");
    expect(() => repo.updateProject(p.id, { ticket_prefix: "XY" })).not.toThrow();
  });

  it("validates prefix length and whitespace", () => {
    const p = repo.createProject("tid-validate");
    expect(() => repo.updateProject(p.id, { ticket_prefix: "X" })).toThrow(/2.*100/i);
    expect(() => repo.updateProject(p.id, { ticket_prefix: "a".repeat(101) })).toThrow(
      /2.*100/i
    );
    expect(() => repo.updateProject(p.id, { ticket_prefix: "A B" })).toThrow(
      /whitespace/i
    );
  });

  it("rejects prefixes that would build an unusable or unsafe key", () => {
    // The prefix is the leading half of a key that travels in URLs and CLI
    // args, so anything outside [A-Za-z][A-Za-z0-9_]* is refused up front.
    const p = repo.createProject("tid-grammar");
    for (const bad of ["A&B", "A-B", "1AB", "A.B", "A/B"]) {
      expect(() => repo.updateProject(p.id, { ticket_prefix: bad })).toThrow(
        /letters, digits and underscores/i
      );
    }
  });

  it("upper-cases the prefix so the stored key matches what resolves", () => {
    const p = repo.createProject("tid-upper");
    expect(repo.updateProject(p.id, { ticket_prefix: "lower" }).ticket_prefix).toBe(
      "LOWER"
    );
    const t = repo.createTask(p.id, { title: "t" });
    expect(t.ticket_key).toBe("LOWER-0001");
    expect(repo.getTask("LOWER-0001").id).toBe(t.id);
  });
});

describe("ticket prefixes are globally unique", () => {
  it("rejects a prefix already taken by another project", () => {
    const a = repo.createProject("tid-uniq-a");
    const b = repo.createProject("tid-uniq-b");
    repo.updateProject(a.id, { ticket_prefix: "UNIQ" });
    expect(() => repo.updateProject(b.id, { ticket_prefix: "UNIQ" })).toThrow(
      /already (in use|taken)/i
    );
  });

  it("compares case-insensitively", () => {
    const a = repo.createProject("tid-uniq-case-a");
    const b = repo.createProject("tid-uniq-case-b");
    repo.updateProject(a.id, { ticket_prefix: "MiXeD" });
    expect(() => repo.updateProject(b.id, { ticket_prefix: "mixed" })).toThrow(
      /already (in use|taken)/i
    );
  });

  it("lets a project keep its own prefix on an unrelated edit", () => {
    const p = repo.createProject("tid-uniq-self");
    repo.updateProject(p.id, { ticket_prefix: "SELF" });
    expect(() => repo.updateProject(p.id, { ticket_prefix: "SELF" })).not.toThrow();
  });

  it("never auto-generates a colliding prefix", () => {
    // Far more projects than the 2-letter space is comfortable with; the
    // generator must retry and widen rather than hand out a duplicate.
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const p = repo.createProject(`tid-gen-${i}`);
      const prefix = p.ticket_prefix!.toLowerCase();
      expect(seen.has(prefix)).toBe(false);
      seen.add(prefix);
    }
  });
});

describe("looking a task up by ticket key", () => {
  it("resolves PREFIX-NNNN to the same task as the nanoid", () => {
    const p = repo.createProject("tid-lookup");
    repo.updateProject(p.id, { ticket_prefix: "LOOK" });
    const t = repo.createTask(p.id, { title: "findable" });
    expect(repo.getTask("LOOK-0001").id).toBe(t.id);
    expect(repo.getTask(t.id).id).toBe(t.id);
  });

  it("matches the prefix case-insensitively after the leading letter", () => {
    const p = repo.createProject("tid-lookup-case");
    repo.updateProject(p.id, { ticket_prefix: "CASE" });
    const t = repo.createTask(p.id, { title: "case" });
    expect(repo.getTask("CaSe-0001").id).toBe(t.id);
  });

  it("does not treat an all-lowercase token as a key", () => {
    // The shape guard is a cheap filter, not a proof: it keeps obvious
    // non-keys from costing a second query. Correctness for ambiguous
    // tokens comes from getTask resolving the storage id first.
    expect(repo.isTicketKey("case-0001")).toBe(false);
    expect(repo.isTicketKey("CASE-0001")).toBe(true);
    expect(repo.isTicketKey("mVRwayTwv3W3")).toBe(false);
  });

  it("404s on an unknown key", () => {
    expect(() => repo.getTask("ZZZZ-9999")).toThrow(/not found/i);
  });

  it("a nanoid shaped like a ticket key still resolves as an id", async () => {
    // nanoid draws from [A-Za-z0-9_-], so a real stored id can look exactly
    // like a ticket key (e.g. "ABC-00012345"). The id must win, or a legacy
    // link could 404 — or worse, silently open the ticket owning that key.
    const { getDb } = await import("./db");
    const p = repo.createProject("tid-ambiguous");
    repo.updateProject(p.id, { ticket_prefix: "AMB" });
    const decoy = repo.createTask(p.id, { title: "decoy" }); // this is AMB-0001
    expect(decoy.ticket_key).toBe("AMB-0001");

    // Give a second task the ambiguous id, as an older nanoid could have been.
    const other = repo.createTask(p.id, { title: "ambiguous" });
    const spoofId = "AMB-00012345";
    getDb().prepare("UPDATE tasks SET id=? WHERE id=?").run(spoofId, other.id);

    expect(repo.isTicketKey(spoofId)).toBe(true); // shape alone says "key"…
    expect(repo.getTask(spoofId).title).toBe("ambiguous"); // …but the id wins
  });

  it("accepts a ticket key wherever a task id is accepted", () => {
    const p = repo.createProject("tid-mutate-by-key");
    repo.updateProject(p.id, { ticket_prefix: "MUT" });
    const t = repo.createTask(p.id, { title: "before" });
    const u = repo.updateTask("MUT-0001", { title: "after", version: t.version });
    expect(u.id).toBe(t.id);
    expect(u.title).toBe("after");
    repo.softDeleteTask("MUT-0001");
    expect(() => repo.getTask(t.id)).toThrow(/not found/i);
  });
});
