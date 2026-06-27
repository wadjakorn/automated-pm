import { describe, it, expect } from "vitest";
import {
  PRIORITIES,
  DEFAULT_PRIORITY,
  isPriority,
  priorityOrder,
} from "./priority";

describe("priority scale", () => {
  it("has the four levels and defaults to medium", () => {
    expect(PRIORITIES).toEqual(["low", "medium", "high", "now"]);
    expect(DEFAULT_PRIORITY).toBe("medium");
  });

  it("validates membership", () => {
    expect(isPriority("now")).toBe(true);
    expect(isPriority("urgent")).toBe(false);
    expect(isPriority(undefined)).toBe(false);
  });

  it("orders now → high → medium → low (ascending sort key)", () => {
    const sorted = ["low", "now", "medium", "high"].sort(
      (a, b) => priorityOrder(a) - priorityOrder(b)
    );
    expect(sorted).toEqual(["now", "high", "medium", "low"]);
  });

  it("sorts unknown/empty priority last", () => {
    expect(priorityOrder("low")).toBeLessThan(priorityOrder("bogus"));
    expect(priorityOrder(null)).toBeGreaterThan(priorityOrder("low"));
  });
});
