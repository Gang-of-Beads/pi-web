import { describe, expect, it } from "vitest";
import type { SessionInfo } from "./api";
import { attentionInbox, attentionReasonLabel, blockedCount, type AttentionInboxInput } from "./attentionInbox";

function session(id: string, modified: string, archived = false): SessionInfo {
  return {
    id, cwd: "/repo", path: `/s/${id}.jsonl`,
    created: modified, modified, messageCount: 1, firstMessage: id,
    ...(archived ? { archived: true } : {}),
  };
}

function input(overrides: Partial<AttentionInboxInput> = {}): AttentionInboxInput {
  return {
    sessionsByMachine: new Map(),
    machineNames: new Map([["local", "Local"], ["laptop", "Laptop"]]),
    waitingSessionIds: new Set(),
    failedSessionIds: new Set(),
    unreadSessionIds: new Set(),
    runningSessionIds: new Set(),
    ...overrides,
  };
}

describe("attentionInbox", () => {
  it("spans machines, so work finished elsewhere is not hidden", () => {
    // The case this exists for: an agent finished on the laptop while the user
    // was looking at the desktop.
    const result = attentionInbox(input({
      sessionsByMachine: new Map([
        ["local", [session("here", "2026-08-18T10:00:00Z")]],
        ["laptop", [session("there", "2026-08-18T11:00:00Z")]],
      ]),
      unreadSessionIds: new Set(["here", "there"]),
    }));

    expect(result.map((c) => c.session.id)).toEqual(["there", "here"]);
    expect(result[0]?.machineName).toBe("Laptop");
  });

  it("orders by urgency before recency", () => {
    const result = attentionInbox(input({
      sessionsByMachine: new Map([["local", [
        session("running", "2026-08-18T12:00:00Z"),
        session("unread", "2026-08-18T11:00:00Z"),
        session("failed", "2026-08-18T10:00:00Z"),
        session("waiting", "2026-08-18T09:00:00Z"),
      ]]]),
      waitingSessionIds: new Set(["waiting"]),
      failedSessionIds: new Set(["failed"]),
      unreadSessionIds: new Set(["unread"]),
      runningSessionIds: new Set(["running"]),
    }));

    // The oldest session is first because it is the one that cannot move.
    expect(result.map((c) => c.reason)).toEqual(["waiting", "failed", "unread", "running"]);
  });

  it("lists a session once, under its most urgent reason", () => {
    const result = attentionInbox(input({
      sessionsByMachine: new Map([["local", [session("both", "2026-08-18T10:00:00Z")]]]),
      waitingSessionIds: new Set(["both"]),
      unreadSessionIds: new Set(["both"]),
      runningSessionIds: new Set(["both"]),
    }));

    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toBe("waiting");
  });

  it("sorts by recency within a reason", () => {
    const result = attentionInbox(input({
      sessionsByMachine: new Map([["local", [
        session("older", "2026-08-18T09:00:00Z"),
        session("newer", "2026-08-18T12:00:00Z"),
      ]]]),
      unreadSessionIds: new Set(["older", "newer"]),
    }));

    expect(result.map((c) => c.session.id)).toEqual(["newer", "older"]);
  });

  it("omits sessions that need nothing", () => {
    const result = attentionInbox(input({
      sessionsByMachine: new Map([["local", [session("quiet", "2026-08-18T10:00:00Z")]]]),
    }));
    expect(result).toEqual([]);
  });

  it("omits archived sessions even when flagged", () => {
    // An archived session is not work in progress, whatever a stale flag says.
    const result = attentionInbox(input({
      sessionsByMachine: new Map([["local", [session("gone", "2026-08-18T10:00:00Z", true)]]]),
      unreadSessionIds: new Set(["gone"]),
    }));
    expect(result).toEqual([]);
  });

  it("falls back to the machine id when its name is unknown", () => {
    const result = attentionInbox(input({
      sessionsByMachine: new Map([["unnamed", [session("x", "2026-08-18T10:00:00Z")]]]),
      unreadSessionIds: new Set(["x"]),
    }));
    expect(result[0]?.machineName).toBe("unnamed");
  });

  it("tolerates an unparseable timestamp instead of dropping the session", () => {
    const broken = { ...session("broken", "2026-08-18T10:00:00Z"), modified: "not a date" };
    const result = attentionInbox(input({
      sessionsByMachine: new Map([["local", [broken, session("ok", "2026-08-18T10:00:00Z")]]]),
      unreadSessionIds: new Set(["broken", "ok"]),
    }));
    expect(result.map((c) => c.session.id)).toEqual(["ok", "broken"]);
  });
});

describe("blockedCount", () => {
  it("counts only what cannot progress without a person", () => {
    const candidates = attentionInbox(input({
      sessionsByMachine: new Map([["local", [
        session("waiting", "2026-08-18T10:00:00Z"),
        session("failed", "2026-08-18T10:00:00Z"),
        session("unread", "2026-08-18T10:00:00Z"),
        session("running", "2026-08-18T10:00:00Z"),
      ]]]),
      waitingSessionIds: new Set(["waiting"]),
      failedSessionIds: new Set(["failed"]),
      unreadSessionIds: new Set(["unread"]),
      runningSessionIds: new Set(["running"]),
    }));

    expect(blockedCount(candidates)).toBe(2);
  });
});

describe("attentionReasonLabel", () => {
  it("says why, not just that", () => {
    expect(attentionReasonLabel("waiting")).toBe("Waiting for you");
    expect(attentionReasonLabel("failed")).toBe("Stopped with an error");
    expect(attentionReasonLabel("unread")).toBe("Finished");
    expect(attentionReasonLabel("running")).toBe("Working");
  });
});
