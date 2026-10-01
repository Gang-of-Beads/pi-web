import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../../shared/apiTypes";
import type { SessionTarget } from "./sessionTarget";
import { sessionTargetView } from "./sessionTargetView";

const names = { machine: "Local", workspace: "repo" };
const session: SessionInfo = { id: "s-1", path: "/sessions/s-1.jsonl", cwd: "/repo", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:01:00.000Z", messageCount: 1, firstMessage: "hi" };

describe("what the chat surface says about a named session it cannot show (P2 slice b)", () => {
  it("names the machine instead of a workspace for a session named with none (B49)", () => {
    const machineOnly = { machine: "Local", workspace: undefined };
    const targets: SessionTarget[] = [{ kind: "gone", sessionId: "s-1" }, { kind: "not-listed", sessionId: "s-1" }];

    expect(targets.map((target) => sessionTargetView(target, machineOnly))).toEqual([
      { role: "alert", text: "This session no longer exists on Local.", wayBack: "Go to Local's sessions" },
      { role: "alert", text: "This session isn't listed on Local.", wayBack: "Go to Local's sessions" },
    ]);
  });

  it("says one honest thing for every target that is not selected, and offers the way back once there is an answer", () => {
    const targets: SessionTarget[] = [
      { kind: "asking", sessionId: "s-1" },
      { kind: "unknown", sessionId: "s-1", miss: { kind: "link-down" } },
      { kind: "gone", sessionId: "s-1" },
      { kind: "not-listed", sessionId: "s-1" },
      { kind: "folder-gone", session: { ...session, cwdMissing: true } },
      { kind: "refused", sessionId: "s-1", fact: "signed-out" },
      { kind: "refused", sessionId: "s-1", fact: "forbidden" },
    ];

    expect(targets.map((target) => sessionTargetView(target, names))).toEqual([
      { role: "status", text: "Loading this session…", wayBack: undefined },
      { role: "status", text: "Loading this session…", wayBack: undefined },
      { role: "alert", text: "This session no longer exists on Local.", wayBack: "Go to repo's sessions" },
      { role: "alert", text: "This session isn't in repo on Local.", wayBack: "Go to repo's sessions" },
      { role: "alert", text: "This session's folder no longer exists, so it cannot be opened.", wayBack: "Go to repo's sessions" },
      { role: "alert", text: "Local asked you to sign in before it opens this session.", wayBack: "Go to repo's sessions" },
      { role: "alert", text: "Local refused to open this session.", wayBack: "Go to repo's sessions" },
    ]);
  });

  it("says nothing for a target that opens: the session itself is on screen", () => {
    expect([sessionTargetView({ kind: "open", session }, names), sessionTargetView({ kind: "archived", session: { ...session, archived: true } }, names)]).toEqual([undefined, undefined]);
  });
});
