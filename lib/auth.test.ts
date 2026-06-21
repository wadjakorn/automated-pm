import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, newApiToken } from "./auth";

describe("password hashing", () => {
  it("does not store the plaintext", () => {
    const stored = hashPassword("hunter2");
    expect(stored).not.toContain("hunter2");
    expect(stored.startsWith("scrypt$")).toBe(true);
  });

  it("verifies the correct password", () => {
    const stored = hashPassword("correct horse");
    expect(verifyPassword("correct horse", stored)).toBe(true);
  });

  it("rejects the wrong password", () => {
    const stored = hashPassword("correct horse");
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("uses a random salt (same password hashes differently)", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("rejects a malformed stored value", () => {
    expect(verifyPassword("x", "not-a-valid-hash")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "bcrypt$aa$bb")).toBe(false);
  });
});

describe("api tokens", () => {
  it("generates distinct tokens", () => {
    expect(newApiToken()).not.toBe(newApiToken());
  });
});
