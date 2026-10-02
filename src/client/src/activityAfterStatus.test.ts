import { describe, expect, it } from "vitest";
import type { SessionActivity, SessionStatus } from "./api";
import { activitiesAfterStatuses } from "./activityAfterStatus";
import { status as baseStatus } from "./controllers/sessionController.testSupport";

const active = (sessionId: string): SessionActivity => ({ sessionId, phase: "active", label: "working", at: "2026-10-01T00:00:00.000Z" });
const idleActivity = (sessionId: string): SessionActivity => ({ sessionId, phase: "idle", label: "idle", at: "2026-10-01T00:00:00.000Z" });
const status = (sessionId: string, isStreaming: boolean): SessionStatus => ({ ...baseStatus(sessionId), isStreaming });

describe("activitiesAfterStatuses (state-diagram D3)", () => {
  it("drops an active activity a status says is over, keeps one a status says runs, and keeps any idle one", () => {
    const after = activitiesAfterStatuses(
      { over: active("over"), runs: active("runs"), quiet: idleActivity("quiet") },
      { over: status("over", false), runs: status("runs", true), quiet: status("quiet", false) },
      { retractsMissing: false },
    );
    expect(Object.keys(after).sort()).toEqual(["quiet", "runs"]);
  });

  it("keeps what the read cannot speak for, whatever the read says", () => {
    const after = activitiesAfterStatuses({ framed: active("framed"), starting: active("starting") }, { framed: status("framed", false) }, { retractsMissing: true, keeps: (sessionId) => sessionId === "framed" || sessionId === "starting" });
    expect(Object.keys(after).sort()).toEqual(["framed", "starting"]);
  });

  it("teaches a session the page knows no activity for the one its status brings, as a live status does (B14)", () => {
    const failed: SessionActivity = { sessionId: "failed", phase: "error", label: "bash complete", at: "2026-10-01T00:00:00.000Z" };
    const stale: SessionActivity = { sessionId: "stale", phase: "active", label: "working", at: "2026-10-01T00:00:00.000Z" };
    const after = activitiesAfterStatuses(
      { known: idleActivity("known") },
      {
        failed: { ...status("failed", false), activity: failed },
        known: { ...status("known", false), activity: { ...failed, sessionId: "known" } },
        stale: { ...status("stale", false), activity: stale },
        selected: { ...status("selected", false), activity: { ...failed, sessionId: "selected" } },
      },
      { retractsMissing: false, adopts: (sessionId) => sessionId !== "selected" },
    );

    expect(after).toEqual({ known: idleActivity("known"), failed });
  });

  it("keeps an active activity with no status unless the caller replaces what it knew", () => {
    const activities = { unlisted: active("unlisted") };
    expect({
      unknown: Object.keys(activitiesAfterStatuses(activities, {}, { retractsMissing: false })),
      retracted: Object.keys(activitiesAfterStatuses(activities, {}, { retractsMissing: true })),
    }).toEqual({ unknown: ["unlisted"], retracted: [] });
  });
});
