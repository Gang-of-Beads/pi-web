import { describe, expect, it } from "vitest";
import type { SessionInfo, Workspace } from "./api";
import { sessionLabel } from "./sessionLabels";
import { quickSwitcherFilterActive, quickSwitcherFilterSessions, renameSessionInList, quickSwitcherModel, quickSwitcherSessionSubtitle, quickSwitcherWorkspaces, sessionIdsIn } from "./quickSwitcher";


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

describe("quickSwitcherFilterSessions", () => {
  const ws = [workspace("main", { projectId: "proj-a", path: "/a/main" }), workspace("feat", { projectId: "proj-a", path: "/a/feat" }), workspace("other", { projectId: "proj-b", path: "/b/main" })];
  const all = [session("1", { cwd: "/a/main" }), session("2", { cwd: "/a/feat" }), session("3", { cwd: "/b/main" })];

  it("is focus mode when empty: every session passes", () => {
    expect(quickSwitcherFilterActive({})).toBe(false);
    expect(quickSwitcherFilterSessions(all, {}, ws)).toHaveLength(3);
  });

  it("narrows to one workspace", () => {
    expect(quickSwitcherFilterSessions(all, { workspacePath: "/a/feat" }, ws).map((s) => s.id)).toEqual(["2"]);
  });

  it("narrows to a project through its workspaces", () => {
    expect(quickSwitcherFilterSessions(all, { projectId: "proj-a" }, ws).map((s) => s.id)).toEqual(["1", "2"]);
    expect(quickSwitcherFilterActive({ projectId: "proj-a" })).toBe(true);
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

describe("filtering to a project whose workspaces have not arrived", () => {
  /**
   * The filter keeps a session when its cwd equals one of the project's
   * workspace paths. Workspaces load per project, one request each, so before
   * that project's response lands the set of paths is empty - and an empty set
   * matches nothing. Picking a project showed "No sessions yet." for a project
   * full of sessions, including the one the reader was sitting in.
   *
   * An empty set is the absence of an answer, not the answer "none". Until the
   * workspaces are known the sessions cannot be judged, so they are shown.
   */
  const sessions = [
    { id: "a", path: "/a.jsonl", cwd: "/repo/pi-web", name: "one", created: "2026-08-27T00:00:00.000Z", modified: "2026-08-27T00:00:00.000Z", messageCount: 1, firstMessage: "" },
    { id: "b", path: "/b.jsonl", cwd: "/repo/other", name: "two", created: "2026-08-27T00:00:00.000Z", modified: "2026-08-27T00:00:00.000Z", messageCount: 1, firstMessage: "" },
  ];

  it("shows the sessions rather than claiming there are none", () => {
    const filtered = quickSwitcherFilterSessions(sessions, { projectId: "pi-web" }, []);

    expect(filtered.map((session) => session.id)).toEqual(["a", "b"]);
  });

  it("filters properly once the workspaces are known", () => {
    const workspaces = [{ id: "w1", projectId: "pi-web", path: "/repo/pi-web", label: "main", isMain: true, effectiveConfig: {} }];
    const filtered = quickSwitcherFilterSessions(sessions, { projectId: "pi-web" }, workspaces);

    expect(filtered.map((session) => session.id)).toEqual(["a"]);
  });
});

/**
 * The switcher's WORKING and waiting groups came from isSessionActive and isWaitingForUser while
 * its badges came from the classifier, so a group and its badge could disagree (B14). Both come
 * from one map now.
 */
describe("the sessions in one category", () => {
  it("are exactly those the classifier put there", () => {
    const states = new Map([["a", "working"], ["b", "asking"], ["c", "working"], ["d", "error"]] as const);

    expect({ working: [...sessionIdsIn(states, "working")], asking: [...sessionIdsIn(states, "asking")], idle: [...sessionIdsIn(states, "idle")] })
      .toEqual({ working: ["a", "c"], asking: ["b"], idle: [] });
  });
});
