import { describe, expect, it } from "vitest";
import type { SessionInfo, Workspace } from "./api";
import { sessionLabel } from "./sessionLabels";
import { renameSessionInList, quickSwitcherModel, quickSwitcherSessionSubtitle, quickSwitcherWorkspaces } from "./quickSwitcher";

const NOW = Date.parse("2026-08-14T12:00:00.000Z");

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    path: `/repo/.pi/sessions/${id}.jsonl`,
    cwd: "/repo",
    persisted: true,
    created: "2026-08-14T11:00:00.000Z",
    modified: "2026-08-14T11:00:00.000Z",
    messageCount: 2,
    firstMessage: "",
    ...overrides,
  };
}

function workspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id,
    projectId: "project-1",
    label: id,
    path: `/repo/${id}`,
    isMain: false,
    effectiveConfig: {},
    ...overrides,
  };
}

function groupIds(sessions: SessionInfo[], activeSessionIds: ReadonlySet<string> = new Set(), query = ""): string[] {
  return quickSwitcherModel({ sessions, activeSessionIds, query, now: NOW }).groups.map((group) => group.id);
}

describe("quickSwitcherModel", () => {
  it("groups sessions by age, newest group first", () => {
    const sessions = [
      session("today", { modified: "2026-08-14T09:00:00.000Z" }),
      session("yesterday", { modified: "2026-08-13T09:00:00.000Z" }),
      session("earlier", { modified: "2026-08-01T09:00:00.000Z" }),
    ];

    expect(groupIds(sessions)).toEqual(["today", "yesterday", "earlier"]);
  });

  it("promotes running sessions above every date group", () => {
    const sessions = [
      session("today", { modified: "2026-08-14T09:00:00.000Z" }),
      session("old-but-running", { modified: "2026-06-01T09:00:00.000Z" }),
    ];

    const model = quickSwitcherModel({ sessions, activeSessionIds: new Set(["old-but-running"]), query: "", now: NOW });

    expect(model.groups[0]?.id).toBe("active");
    expect(model.groups[0]?.sessions.map((item) => item.id)).toEqual(["old-but-running"]);
  });

  it("orders each group by most recently modified", () => {
    const sessions = [
      session("older", { modified: "2026-08-14T08:00:00.000Z" }),
      session("newer", { modified: "2026-08-14T10:00:00.000Z" }),
    ];

    const model = quickSwitcherModel({ sessions, activeSessionIds: new Set(), query: "", now: NOW });

    expect(model.groups[0]?.sessions.map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("hides archived sessions", () => {
    const sessions = [session("live"), session("gone", { archived: true })];

    const model = quickSwitcherModel({ sessions, activeSessionIds: new Set(), query: "", now: NOW });

    expect(model.matchCount).toBe(1);
    expect(model.groups.flatMap((group) => group.sessions).map((item) => item.id)).toEqual(["live"]);
  });

  it("filters by the shared session search rules", () => {
    const sessions = [session("a", { name: "billing refactor" }), session("b", { name: "mobile layout" })];

    const model = quickSwitcherModel({ sessions, activeSessionIds: new Set(), query: "mobile", now: NOW });

    expect(model.matchCount).toBe(1);
    expect(model.groups.flatMap((group) => group.sessions).map((item) => item.id)).toEqual(["b"]);
  });

  it("reports no groups when nothing matches", () => {
    const model = quickSwitcherModel({ sessions: [session("a", { name: "billing" })], activeSessionIds: new Set(), query: "zzzz", now: NOW });

    expect(model.groups).toEqual([]);
    expect(model.matchCount).toBe(0);
  });

  it("treats an unparsable timestamp as an old session instead of dropping it", () => {
    expect(groupIds([session("broken", { modified: "not-a-date" })])).toEqual(["earlier"]);
  });
});

describe("quickSwitcherWorkspaces", () => {
  const workspaces = [workspace("main", { path: "/repo/main" }), workspace("feature-login", { path: "/repo/feature-login" })];

  it("returns every workspace without a query", () => {
    expect(quickSwitcherWorkspaces(workspaces, "  ").map((item) => item.id)).toEqual(["main", "feature-login"]);
  });

  it("matches the label and the path", () => {
    expect(quickSwitcherWorkspaces(workspaces, "login").map((item) => item.id)).toEqual(["feature-login"]);
    expect(quickSwitcherWorkspaces(workspaces, "/repo/main").map((item) => item.id)).toEqual(["main"]);
  });

  it("requires every token to match", () => {
    expect(quickSwitcherWorkspaces(workspaces, "feature zzz")).toEqual([]);
  });
});

describe("quickSwitcherSessionSubtitle", () => {
  it("names the owning workspace alongside the message count", () => {
    const workspaces = [workspace("main", { path: "/repo/main", label: "main" })];

    expect(quickSwitcherSessionSubtitle(session("a", { cwd: "/repo/main", messageCount: 3 }), workspaces)).toBe("main · 3 messages");
  });

  it("falls back to the message count when the workspace is not listed", () => {
    expect(quickSwitcherSessionSubtitle(session("a", { cwd: "/elsewhere", messageCount: 1 }), [])).toBe("1 message");
  });
});

describe("quickSwitcherModel attention ranking", () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");

  function session(id: string, modified = "2026-08-18T11:59:00.000Z") {
    return { id, cwd: "/repo", path: `/s/${id}.jsonl`, created: modified, modified, messageCount: 1, firstMessage: id };
  }

  it("ranks waiting above running, running above unread, and unread above plain recency", () => {
    const sessions = [session("recent"), session("unread"), session("running"), session("waiting")];

    const model = quickSwitcherModel({
      sessions,
      activeSessionIds: new Set(["running"]),
      waitingSessionIds: new Set(["waiting"]),
      unreadSessionIds: new Set(["unread"]),
      query: "",
      now,
    });

    expect(model.groups.map((group) => group.id)).toEqual(["waiting", "active", "unread", "today"]);
    expect(model.groups[0]?.sessions.map((entry) => entry.id)).toEqual(["waiting"]);
    expect(model.groups[3]?.sessions.map((entry) => entry.id)).toEqual(["recent"]);
  });

  it("puts a session blocked on a question above one that is merely running", () => {
    // Both need attention, but only the blocked one cannot progress without it.
    const model = quickSwitcherModel({
      sessions: [session("both")],
      activeSessionIds: new Set(["both"]),
      waitingSessionIds: new Set(["both"]),
      unreadSessionIds: new Set(["both"]),
      query: "",
      now,
    });

    expect(model.groups.map((group) => group.id)).toEqual(["waiting"]);
  });

  it("names the attention groups for what they mean to the user", () => {
    const model = quickSwitcherModel({
      sessions: [session("a"), session("b")],
      activeSessionIds: new Set(["b"]),
      waitingSessionIds: new Set(["a"]),
      unreadSessionIds: new Set(),
      query: "",
      now,
    });

    expect(model.groups.map((group) => group.title)).toEqual(["Waiting for you", "Working"]);
  });

  it("still ranks by attention when a query filters the list", () => {
    const model = quickSwitcherModel({
      sessions: [session("alpha-recent"), session("alpha-waiting")],
      activeSessionIds: new Set(),
      waitingSessionIds: new Set(["alpha-waiting"]),
      unreadSessionIds: new Set(),
      query: "alpha",
      now,
    });

    expect(model.groups[0]?.id).toBe("waiting");
    expect(model.matchCount).toBe(2);
  });

  it("falls back to date grouping when no attention signals are supplied", () => {
    // The sets are optional so callers without unread/ask data keep working.
    const model = quickSwitcherModel({
      sessions: [session("only")],
      activeSessionIds: new Set(),
      query: "",
      now,
    });

    expect(model.groups.map((group) => group.id)).toEqual(["today"]);
  });
});

describe("interrupted runs", () => {
  // A session a restart cut off is not going to finish on its own, and looks
  // identical to an idle one in the list -- which is how a running session
  // became impossible to find again after the daemon restarted under it.
  it("ranks an interrupted session above everything except a blocked one", () => {
    const model = quickSwitcherModel({
      sessions: [
        session("idle", { modified: "2026-08-18T10:00:00Z" }),
        session("cut-off", { modified: "2026-08-18T08:00:00Z" }),
        session("busy", { modified: "2026-08-18T09:00:00Z" }),
      ],
      activeSessionIds: new Set(["busy"]),
      interruptedSessionIds: new Set(["cut-off"]),
      query: "",
      now: Date.parse("2026-08-18T11:00:00Z"),
    });

    const order = model.groups.flatMap((group) => group.sessions.map((entry) => entry.id));
    expect(order.indexOf("cut-off")).toBeLessThan(order.indexOf("busy"));
    expect(order.indexOf("cut-off")).toBeLessThan(order.indexOf("idle"));
    expect(model.groups.find((group) => group.id === "interrupted")?.title).toBe("Interrupted");
  });

  it("does not report a session as interrupted once it is working again", () => {
    const model = quickSwitcherModel({
      sessions: [session("resumed", { modified: "2026-08-18T10:00:00Z" })],
      activeSessionIds: new Set(["resumed"]),
      interruptedSessionIds: new Set(["resumed"]),
      query: "",
      now: Date.parse("2026-08-18T11:00:00Z"),
    });
    expect(model.groups.find((group) => group.id === "interrupted")).toBeUndefined();
    expect(model.groups.find((group) => group.id === "active")?.sessions).toHaveLength(1);
  });
});

describe("renamed sessions", () => {
  // The switcher keeps its own copy of the session list, loaded once. Renaming
  // a session updated the context bar and the navigation list but not that
  // copy, so the switcher went on offering the old name -- and the old name is
  // exactly what the user renamed away from because it was unrecognisable.
  it("shows the new name in the cached list", () => {
    const sessions = [
      session("kept", { name: "other work", modified: "2026-08-18T09:00:00Z" }),
      session("renamed", { firstMessage: 'Error: Anthropic account "personal" failed closed', modified: "2026-08-18T10:00:00Z" }),
    ];

    const updated = renameSessionInList(sessions, "renamed", "web pi");

    const model = quickSwitcherModel({
      sessions: updated,
      activeSessionIds: new Set(),
      query: "",
      now: Date.parse("2026-08-18T11:00:00Z"),
    });
    const titles = model.groups.flatMap((group) => group.sessions.map((entry) => sessionLabel(entry)));
    expect(titles).toContain("web pi");
    expect(titles.some((title) => title.startsWith("Error:"))).toBe(false);
  });

  it("leaves the list alone when the session is not in it", () => {
    const sessions = [session("kept", { name: "other work" })];
    expect(renameSessionInList(sessions, "absent", "new name")).toBe(sessions);
  });
});
