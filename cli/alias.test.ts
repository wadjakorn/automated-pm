import { describe, it, expect } from "vitest";
import { ALIAS } from "./pm";

describe("action aliases", () => {
  it("maps ls/mv/rm to canonical actions", () => {
    expect(ALIAS.ls).toBe("list");
    expect(ALIAS.mv).toBe("move");
    expect(ALIAS.rm).toBe("delete");
  });
});
