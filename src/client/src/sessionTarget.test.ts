import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../../shared/apiTypes";
import { HttpError } from "./api/http";
import { isResolved, placeSessionId, targetFromLocateError, targetFromLocation, targetInListing, targetInScope, targetUnanswered, type ScopedSessionTarget, type SessionTarget } from "./sessionTarget";

function session(id: string, patch: Partial<SessionInfo> = {}): SessionInfo {
  return { id, path: `/sessions/${id}.jsonl`, cwd: "/repo", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:01:00.000Z", messageCount: 1, firstMessage: "hi", ...patch };
}

describe("the target of a session link (P2 slice b, B31)", () => {
  it("names each listed session by what can be done with it, and asks about one the listing lacks", () => {
    const listing = [session("live-1"), session("old-1", { archived: true }), session("dead-1", { cwdMissing: true })];

    expect(Object.fromEntries(["live-1", "old-1", "dead-1", "deleted-1"].map((id) => [id, targetInListing(listing, id).kind]))).toEqual({
      "live-1": "open",
      "old-1": "archived",
      "dead-1": "folder-gone",
      "deleted-1": "asking",
    });
  });

  it("prefers the whole id over a prefix, and accepts a unique prefix", () => {
    const listing = [session("abc-long"), session("abc")];

    expect(targetInListing(listing, "abc")).toMatchObject({ kind: "open", session: { id: "abc" } });
    expect(targetInListing([session("abc-long")], "abc")).toMatchObject({ kind: "open", session: { id: "abc-long" } });
  });

  it("decides a located session the same way as a listed one, and an older daemon's silence as not listed", () => {
    expect(targetFromLocation("s1", { kind: "found", session: session("s1", { archived: true }) }).kind).toBe("archived");
    expect(targetFromLocation("s1", { kind: "found", session: session("s1") }).kind).toBe("open");
    expect(targetFromLocation("s1", { kind: "unsupported" })).toEqual({ kind: "not-listed", sessionId: "s1" });
  });

  it("makes only the daemon's code a gone session; a refusal is a fact; anything else is unknown and asked again", () => {
    const outcomes = {
      code: targetFromLocateError("s1", new HttpError("Session not found", 404, "local", undefined, "session-not-found")),
      "coded-less 404": targetFromLocateError("s1", new HttpError("Session not found", 404, "local")),
      "signed out": targetFromLocateError("s1", new HttpError("Unauthorized", 401, "local")),
      forbidden: targetFromLocateError("s1", new HttpError("Forbidden", 403, "local")),
      "server error": targetFromLocateError("s1", new HttpError("EIO: i/o error, read", 500, "local")),
      "link down": targetFromLocateError("s1", new TypeError("Failed to fetch")),
    };

    expect(Object.fromEntries(Object.entries(outcomes).map(([name, target]) => [name, target.kind === "refused" ? `refused:${target.fact}` : target.kind]))).toEqual({
      code: "gone",
      "coded-less 404": "unknown",
      "signed out": "refused:signed-out",
      forbidden: "refused:forbidden",
      "server error": "unknown",
      "link down": "unknown",
    });
  });

  it("shows a target only in the machine and workspace it was asked in, and only while nothing is selected", () => {
    const named: ScopedSessionTarget = { machineId: "local", workspaceId: "ws-1", cwd: "/repo", sessionId: "gone-1", target: { kind: "gone", sessionId: "gone-1" } };
    const here = { selectedMachine: undefined, selectedWorkspace: { id: "ws-1" }, selectedSession: undefined, sessionTarget: named };

    expect({
      here: targetInScope(here)?.sessionId,
      "another workspace": targetInScope({ ...here, selectedWorkspace: { id: "ws-2" } })?.sessionId,
      "another machine": targetInScope({ ...here, selectedMachine: { id: "remote" } })?.sessionId,
      "a session selected": targetInScope({ ...here, selectedSession: { id: "live-1" } })?.sessionId,
    }).toEqual({ here: "gone-1", "another workspace": undefined, "another machine": undefined, "a session selected": undefined });
    expect([placeSessionId(here), placeSessionId({ ...here, selectedSession: { id: "live-1" } }), placeSessionId({ ...here, sessionTarget: undefined })]).toEqual(["gone-1", "live-1", undefined]);
  });

  it("hands an unanswered target to the app row with when it went unanswered, and nothing else", () => {
    const scope = { machineId: "local", workspaceId: "ws-1", cwd: "/repo", sessionId: "s-1" };
    const miss = { kind: "server-error", machineId: "local", reason: "EIO: i/o error, read" } as const;

    expect([
      targetUnanswered({ ...scope, target: { kind: "unknown", sessionId: "s-1", miss }, unansweredSince: 1_000 }),
      targetUnanswered({ ...scope, target: { kind: "asking", sessionId: "s-1" } }),
      targetUnanswered({ ...scope, target: { kind: "gone", sessionId: "s-1" } }),
      targetUnanswered(undefined),
    ]).toEqual([{ miss, since: 1_000 }, undefined, undefined, undefined]);
  });

  it("keeps asking only while nothing has answered", () => {
    const targets: SessionTarget[] = [
      { kind: "open", session: session("a") },
      { kind: "archived", session: session("a", { archived: true }) },
      { kind: "folder-gone", session: session("a", { cwdMissing: true }) },
      { kind: "asking", sessionId: "a" },
      { kind: "unknown", sessionId: "a", miss: { kind: "link-down" } },
      { kind: "gone", sessionId: "a" },
      { kind: "not-listed", sessionId: "a" },
      { kind: "refused", sessionId: "a", fact: "forbidden" },
    ];

    expect(Object.fromEntries(targets.map((target) => [target.kind, isResolved(target)]))).toEqual({
      open: true,
      archived: true,
      "folder-gone": true,
      asking: false,
      unknown: false,
      gone: true,
      "not-listed": true,
      refused: true,
    });
  });
});
