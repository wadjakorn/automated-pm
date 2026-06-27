import { describe, it, expect } from "vitest";
import { copyText } from "./clipboard";

describe("copyText", () => {
  it("uses the async Clipboard API when available", async () => {
    const written: string[] = [];
    const ok = await copyText("hello", {
      clipboardWrite: async (t) => {
        written.push(t);
      },
    });
    expect(ok).toBe(true);
    expect(written).toEqual(["hello"]);
  });

  it("falls back to legacy copy when the Clipboard API is absent (insecure HTTP context)", async () => {
    const copied: string[] = [];
    const ok = await copyText("hello", {
      legacyCopy: (t) => {
        copied.push(t);
        return true;
      },
    });
    expect(ok).toBe(true);
    expect(copied).toEqual(["hello"]);
  });

  it("falls back to legacy copy when the Clipboard API throws", async () => {
    const copied: string[] = [];
    const ok = await copyText("hello", {
      clipboardWrite: async () => {
        throw new Error("NotAllowedError");
      },
      legacyCopy: (t) => {
        copied.push(t);
        return true;
      },
    });
    expect(ok).toBe(true);
    expect(copied).toEqual(["hello"]);
  });

  it("returns false when no copy mechanism is available", async () => {
    const ok = await copyText("hello", {});
    expect(ok).toBe(false);
  });

  it("returns false when legacy copy fails too", async () => {
    const ok = await copyText("hello", {
      clipboardWrite: async () => {
        throw new Error("denied");
      },
      legacyCopy: () => false,
    });
    expect(ok).toBe(false);
  });
});
