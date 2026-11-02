import { describe, expect, it } from "vitest";
import { boardPollMs, parseStreamEvent, POLL_FAST_MS, POLL_LIVE_MS } from "./live-logic";
import { groupByProject } from "./home-logic";

describe("parseStreamEvent", () => {
  it("parses a valid activity payload", () => {
    expect(
      parseStreamEvent('{"seq":7,"task_id":"t1","project_id":"p1","type":"status"}')
    ).toEqual({ seq: 7, task_id: "t1", project_id: "p1", type: "status" });
  });

  it("ignores malformed payloads", () => {
    expect(parseStreamEvent("not json")).toBeNull();
    expect(parseStreamEvent('{"seq":"7","task_id":"t1","project_id":"p1"}')).toBeNull();
    expect(parseStreamEvent(undefined)).toBeNull();
  });
});

describe("boardPollMs", () => {
  it("slows the poll while the stream is connected", () => {
    expect(boardPollMs(true)).toBe(POLL_LIVE_MS);
    expect(boardPollMs(false)).toBe(POLL_FAST_MS);
    expect(POLL_LIVE_MS).toBeGreaterThan(POLL_FAST_MS);
  });
});

describe("groupByProject", () => {
  it("groups in first-appearance order and keeps row order", () => {
    const rows = [
      { id: "1", project_id: "b", project_name: "B" },
      { id: "2", project_id: "a", project_name: "A" },
      { id: "3", project_id: "b", project_name: "B" },
    ];
    expect(groupByProject(rows)).toEqual([
      { project_id: "b", project_name: "B", items: [rows[0], rows[2]] },
      { project_id: "a", project_name: "A", items: [rows[1]] },
    ]);
  });
});
