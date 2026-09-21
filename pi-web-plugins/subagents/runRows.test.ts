import { describe, expect, it } from "vitest";
import { formatElapsed, runPresentation, subagentListState } from "./runRows";

/**
 * Owner report: the browser could not show which subagents were working. Every
 * state the reader can report is named here, including the two that are not
 * outcomes - a run that went silent, and an answer that knows nothing.
 */
describe("the subagent list state", () => {
  it("separates 'not known' from 'none'", () => {
    expect(subagentListState({ known: false, reason: "no-session" })).toEqual({
      kind: "unknown",
      reason: "Open a session to see its subagents.",
    });
    expect(subagentListState({ known: true, runs: [] })).toEqual({ kind: "empty" });
    expect(subagentListState(undefined).kind).toBe("unknown");
    expect(subagentListState({ known: true }).kind).toBe("unknown");
  });

  it("counts what is working", () => {
    const state = subagentListState({
      known: true,
      runs: [
        { runId: "a", agent: "reviewer", status: "running", elapsedMs: 5000, startedAt: "", hasOutput: false },
        { runId: "b", agent: "reviewer", status: "done", elapsedMs: 9000, startedAt: "", hasOutput: true },
      ],
    });
    expect(state).toMatchObject({ kind: "rows", running: 1 });
  });

  it("drops rows it cannot identify rather than rendering blanks", () => {
    const state = subagentListState({ known: true, runs: [{ nonsense: true }, { runId: "a", agent: "x", status: "running" }] });
    expect(state.kind === "rows" ? state.rows.length : 0).toBe(1);
  });
});

describe("one run's presentation", () => {
  const row = { runId: "r", agent: "reviewer", elapsedMs: 65_000, startedAt: "", hasOutput: true };

  it("names every status", () => {
    expect(runPresentation({ ...row, status: "running", lastActivity: "reading files" })).toMatchObject({ label: "Working", tone: "running" });
    expect(runPresentation({ ...row, status: "done" })).toMatchObject({ label: "Done", tone: "settled" });
    expect(runPresentation({ ...row, status: "failed" })).toMatchObject({ label: "Failed", tone: "problem" });
    expect(runPresentation({ ...row, status: "lost" })).toMatchObject({ label: "Lost", tone: "problem" });
    expect(runPresentation({ ...row, status: "unknown" })).toMatchObject({ label: "Unknown", tone: "unknown" });
  });

  it("says a finished run wrote nothing rather than implying it did", () => {
    expect(runPresentation({ ...row, status: "done", hasOutput: false }).detail).toContain("no output written");
  });

  it("does not dress a silent run as a failure", () => {
    expect(runPresentation({ ...row, status: "lost" }).detail).toContain("went silent without an outcome");
  });
});

describe("elapsed time", () => {
  it("reads in the unit a reader can use", () => {
    expect(formatElapsed(4000)).toBe("4s");
    expect(formatElapsed(65_000)).toBe("1m 5s");
    expect(formatElapsed(3_900_000)).toBe("1h 5m");
    expect(formatElapsed(Number.NaN)).toBe("unknown");
  });
});
