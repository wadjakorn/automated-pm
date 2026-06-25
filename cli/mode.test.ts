import { describe, it, expect } from "vitest";
import { resolveGlobals } from "./mode";

const base = { isTTY: false, env: {} as Record<string, string | undefined> };

describe("resolveGlobals", () => {
  it("defaults to json when not a TTY", () => {
    const r = resolveGlobals({ ...base, argv: ["project", "list"] });
    expect(r.mode).toBe("json");
    expect(r.argv).toEqual(["project", "list"]);
  });

  it("defaults to pretty on a TTY", () => {
    const r = resolveGlobals({ ...base, isTTY: true, argv: ["project", "list"] });
    expect(r.mode).toBe("pretty");
  });

  it("--json overrides a TTY", () => {
    const r = resolveGlobals({ ...base, isTTY: true, argv: ["project", "list", "--json"] });
    expect(r.mode).toBe("json");
    expect(r.argv).toEqual(["project", "list"]);
  });

  it("--json beats --pretty", () => {
    const r = resolveGlobals({ ...base, argv: ["x", "--pretty", "--json"] });
    expect(r.mode).toBe("json");
  });

  it("color on only in pretty without NO_COLOR/--no-color", () => {
    expect(resolveGlobals({ ...base, isTTY: true, argv: ["x"] }).color).toBe(true);
    expect(resolveGlobals({ ...base, isTTY: true, argv: ["x", "--no-color"] }).color).toBe(false);
    expect(resolveGlobals({ isTTY: true, env: { NO_COLOR: "1" }, argv: ["x"] }).color).toBe(false);
    expect(resolveGlobals({ ...base, argv: ["x", "--pretty"] }).color).toBe(true);
  });

  it("--api consumes the next token; falls back to env then default", () => {
    expect(resolveGlobals({ ...base, argv: ["x", "--api", "http://h:9"] }).api).toBe("http://h:9");
    expect(resolveGlobals({ ...base, argv: ["x", "--api", "http://h:9"] }).argv).toEqual(["x"]);
    expect(resolveGlobals({ isTTY: false, env: { PM_API: "http://e:8" }, argv: ["x"] }).api).toBe("http://e:8");
    expect(resolveGlobals({ ...base, argv: ["x"] }).api).toBe("http://localhost:3000");
  });

  it("--version / -v set showVersion and are stripped", () => {
    expect(resolveGlobals({ ...base, argv: ["--version"] }).showVersion).toBe(true);
    expect(resolveGlobals({ ...base, argv: ["-v"] }).showVersion).toBe(true);
    expect(resolveGlobals({ ...base, argv: ["project", "-v", "list"] }).argv).toEqual(["project", "list"]);
  });
});
