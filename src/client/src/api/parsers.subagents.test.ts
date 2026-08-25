import { describe, expect, it } from "vitest";
import type { SessionSubagentInfo, SessionSubagentRunInfo } from "../../../shared/apiTypes";
import { parseSessionSubagentsSnapshot } from "./parsers";

// Keyed by the union, so adding a status without teaching the parser about it
// stops compiling here rather than silently dropping those rows in the browser.
const RUN_STATUSES: Record<SessionSubagentRunInfo["status"], true> = {
  running: true, done: true, failed: true, lost: true, unknown: true,
};
const SUBSESSION_STATUSES: Record<SessionSubagentInfo["status"], true> = {
  working: true, idle: true, error: true, unknown: true,
};

function runWire(status: string): Record<string, unknown> {
  return { runId: `run-${status}`, agent: "worker", status, elapsedMs: 1000, startedAt: "2026-08-25T10:00:00.000Z" };
}

describe("subagent snapshot parsing", () => {
  it("keeps every run status the server can send", () => {
    const statuses = Object.keys(RUN_STATUSES);

    const parsed = parseSessionSubagentsSnapshot({ subsessions: [], toolRuns: statuses.map(runWire) });

    expect(parsed.toolRuns.map((run) => run.status)).toEqual(statuses);
  });

  it("keeps every subsession status the server can send", () => {
    const statuses = Object.keys(SUBSESSION_STATUSES);

    const parsed = parseSessionSubagentsSnapshot({
      subsessions: statuses.map((status) => ({ sessionId: `s-${status}`, cwd: "/repo", status })),
      toolRuns: [],
    });

    expect(parsed.subsessions.map((entry) => entry.status)).toEqual(statuses);
  });

  it("drops a row whose status is not one of them", () => {
    const parsed = parseSessionSubagentsSnapshot({ subsessions: [], toolRuns: [runWire("elsewhere")] });

    expect(parsed.toolRuns).toEqual([]);
  });
});
