import { describe, it, expect } from "vitest";
import { resolveTheme, nextChoice } from "./theme";

describe("resolveTheme", () => {
  it("explicit choices win", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("system follows prefersDark", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("nextChoice", () => {
  it("cycles light → dark → system → light", () => {
    expect(nextChoice("light")).toBe("dark");
    expect(nextChoice("dark")).toBe("system");
    expect(nextChoice("system")).toBe("light");
  });
});
