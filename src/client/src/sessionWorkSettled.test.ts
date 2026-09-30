import { describe, expect, it } from "vitest";
import type { SessionActivity, SessionStatus } from "./api";
import { sessionWorkSettled, type SessionWorkState } from "./sessionWorkSettled";

function status(patch: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "a",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...patch,
  };
}

const working: SessionActivity = { sessionId: "a", phase: "active", label: "working", at: "now" };
const on = (id: string, patch: Omit<SessionWorkState, "selectedSession">): SessionWorkState => ({ selectedSession: { id }, ...patch });

describe("when the selected session's work settles (plugins hear session-activity-settled)", () => {
  it("settles when its turn ends and when the last of its background runs ends, and at no other edge", () => {
    expect({
      turnEnds: sessionWorkSettled(on("a", { status: status({ isStreaming: true }) }), on("a", { status: status() })),
      activityEnds: sessionWorkSettled(on("a", { status: status(), activity: working }), on("a", { status: status() })),
      turnEndsWithRunsLeft: sessionWorkSettled(on("a", { status: status({ isStreaming: true, backgroundRunCount: 1 }) }), on("a", { status: status({ backgroundRunCount: 1 }) })),
      lastRunEnds: sessionWorkSettled(on("a", { status: status({ backgroundRunCount: 1 }) }), on("a", { status: status() })),
      oneOfTwoRunsEnds: sessionWorkSettled(on("a", { status: status({ backgroundRunCount: 2 }) }), on("a", { status: status({ backgroundRunCount: 1 }) })),
      lastRunEndsDuringATurn: sessionWorkSettled(on("a", { status: status({ isStreaming: true, backgroundRunCount: 1 }) }), on("a", { status: status({ isStreaming: true }) })),
      runsLeftByAnotherSession: sessionWorkSettled(on("a", { status: status({ backgroundRunCount: 1 }) }), on("b", { status: undefined })),
      stillIdle: sessionWorkSettled(on("a", { status: status() }), on("a", { status: status() })),
      turnStarts: sessionWorkSettled(on("a", { status: status() }), on("a", { status: status({ isStreaming: true }) })),
    }).toEqual({
      turnEnds: true,
      activityEnds: true,
      turnEndsWithRunsLeft: true,
      lastRunEnds: true,
      oneOfTwoRunsEnds: false,
      lastRunEndsDuringATurn: false,
      runsLeftByAnotherSession: false,
      stillIdle: false,
      turnStarts: false,
    });
  });
});
