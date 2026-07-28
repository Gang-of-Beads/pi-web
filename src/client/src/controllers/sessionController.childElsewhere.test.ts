import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { initialAppState, type AppState } from "../appState";
import { childElsewhereCountPatch } from "./sessionController";

const PARENT_PATH = "/sessions/--srv-dev-pi-web--/parent.jsonl";

describe("childElsewhereCountPatch", () => {
  it("starts the count when a first child is created in another workspace", () => {
    const parent = session("parent", { path: PARENT_PATH });

    const patch = childElsewhereCountPatch(stateWith([parent]), childElsewhere());

    expect(patch?.sessions?.[0]).toMatchObject({ id: "parent", childSessionsElsewhere: 1 });
  });

  it("increments an existing count so repeated spawns stay accurate", () => {
    const parent = session("parent", { path: PARENT_PATH, childSessionsElsewhere: 2 });

    const patch = childElsewhereCountPatch(stateWith([parent]), childElsewhere());

    expect(patch?.sessions?.[0]).toMatchObject({ childSessionsElsewhere: 3 });
  });

  it("leaves other listed sessions untouched", () => {
    const parent = session("parent", { path: PARENT_PATH });
    const unrelated = session("unrelated", { path: "/sessions/--srv-dev-pi-web--/unrelated.jsonl" });

    const patch = childElsewhereCountPatch(stateWith([parent, unrelated]), childElsewhere());

    expect(patch?.sessions?.[1]).toBe(unrelated);
  });

  it("ignores a created session whose parent is not in the current listing", () => {
    const state = stateWith([session("other", { path: "/sessions/--srv-dev-pi-web--/other.jsonl" })]);

    expect(childElsewhereCountPatch(state, childElsewhere())).toBeUndefined();
  });

  it("credits the parent when the broadcast path differs only by a trailing separator", () => {
    // The created session's parentSessionPath comes from the live runtime, while
    // the listed parent's path comes from the session store enumeration.
    const parent = session("parent", { path: PARENT_PATH });
    const created = session("child", { cwd: "/srv/dev/pi-web-feature", parentSessionPath: `${PARENT_PATH}/` });

    const patch = childElsewhereCountPatch(stateWith([parent]), created);

    expect(patch?.sessions?.[0]).toMatchObject({ childSessionsElsewhere: 1 });
  });

  it("ignores a created root session, which has no parent to credit", () => {
    const parent = session("parent", { path: PARENT_PATH });
    const root = session("root", { cwd: "/srv/dev/pi-web-feature" });
    delete root.parentSessionPath;

    expect(childElsewhereCountPatch(stateWith([parent]), root)).toBeUndefined();
  });
});

function stateWith(sessions: SessionInfo[]): AppState {
  return { ...initialAppState(), sessions };
}

function childElsewhere(): SessionInfo {
  return session("child", { cwd: "/srv/dev/pi-web-feature", parentSessionPath: PARENT_PATH });
}

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/srv/dev/pi-web",
    created: "2026-07-28T00:00:00.000Z",
    modified: "2026-07-28T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
    ...overrides,
  };
}
