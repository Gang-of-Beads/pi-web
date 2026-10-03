import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../../../shared/apiTypes";
import type { SessionLocation } from "../api/clients";
import { HttpError } from "../api/http";
import type { ScopedSessionTarget, SessionTargetScope } from "../sessionTarget";
import { SessionTargetResolver } from "./sessionTargetResolver";

const scope: SessionTargetScope = { machineId: "local", workspaceId: "ws-1", cwd: "/repo", sessionId: "s-1" };

function session(id: string, patch: Partial<SessionInfo> = {}): SessionInfo {
  return { id, path: `/sessions/${id}.jsonl`, cwd: "/repo", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:01:00.000Z", messageCount: 1, firstMessage: "hi", ...patch };
}

function harness(answers: (() => Promise<SessionLocation>)[]) {
  const published: (string | undefined)[] = [];
  const unansweredSince: (number | undefined)[] = [];
  const reported: string[] = [];
  const clock = { now: 5_000 };
  const opened: string[] = [];
  const openedOn: string[] = [];
  const asked: { id: string; cwd: string; machineId: string }[] = [];
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const resolver = new SessionTargetResolver({
    locate: (ref, machineId) => {
      asked.push({ id: ref.id, cwd: ref.cwd, machineId });
      const next = answers.shift();
      return next === undefined ? Promise.reject(new Error("no more answers")) : next();
    },
    publish: (target: ScopedSessionTarget | undefined) => {
      published.push(target === undefined ? undefined : target.target.kind);
      unansweredSince.push(target?.unansweredSince);
    },
    open: (opening, options, followed) => {
      openedOn.push(followed.machineId);
      if (opening.id === "fails-to-open") return Promise.reject(new Error("the transcript read failed"));
      opened.push(options.updateUrl === false ? `${opening.id} (url kept)` : opening.id);
      return Promise.resolve();
    },
    now: () => clock.now,
    reportError: (error) => { reported.push(error instanceof Error ? error.message : String(error)); },
    schedule: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
  });
  const fire = async () => {
    const timer = timers.find((candidate) => !candidate.cancelled);
    if (timer === undefined) throw new Error("no retry is scheduled");
    timer.cancelled = true;
    timer.run();
    await settle();
  };
  return { resolver, published, opened, openedOn, asked, timers, fire, unansweredSince, reported, clock };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
}

const missing = () => Promise.reject(new HttpError("Session not found", 404, "local", undefined, "session-not-found"));
const unanswered = () => Promise.reject(new TypeError("Failed to fetch"));

describe("resolving a session a link names (P2 slice b)", () => {
  it("opens a listed session at once and asks nobody", async () => {
    const { resolver, opened, asked } = harness([]);

    await resolver.follow(scope, { kind: "open", session: session("s-1") });

    expect({ opened, asked }).toEqual({ opened: ["s-1"], asked: [] });
  });

  it("keeps the URL a restore came from when the answer opens the session later", async () => {
    const { resolver, opened } = harness([() => Promise.resolve({ kind: "found", session: session("s-1") })]);

    await resolver.follow(scope, { kind: "asking", sessionId: "s-1" }, { updateUrl: false });
    await settle();

    expect(opened).toEqual(["s-1 (url kept)"]);
  });

  it("asks the daemon about a session the listing lacks, and says it is gone only on the code", async () => {
    const { resolver, published, opened, asked } = harness([missing]);

    await resolver.follow(scope, { kind: "asking", sessionId: "s-1" });
    await settle();

    expect({ published, opened, asked }).toEqual({ published: ["asking", "gone"], opened: [], asked: [{ id: "s-1", cwd: "/repo", machineId: "local" }] });
  });

  /** Review ca45d6ed: the session a retry finds belongs to the machine it was followed on, which the opener checks against the page's. */
  it("tells the opener which machine a retry found the session on", async () => {
    const { resolver, openedOn, fire } = harness([unanswered, () => Promise.resolve({ kind: "found", session: session("s-1") })]);

    await resolver.follow({ ...scope, machineId: "remote-b" }, { kind: "asking", sessionId: "s-1" });
    await settle();
    await fire();

    expect(openedOn).toEqual(["remote-b"]);
  });

  it("opens a session the daemon locates, wherever it is recorded", async () => {
    const { resolver, opened } = harness([() => Promise.resolve({ kind: "found", session: session("s-1", { cwd: "/repo/packages/app" }) })]);

    await resolver.follow(scope, { kind: "asking", sessionId: "s-1" });
    await settle();

    expect(opened).toEqual(["s-1"]);
  });

  it("never gives up on a locate that got no answer, and waits longer each time up to the quiet window", async () => {
    const { resolver, published, opened, timers, fire } = harness([unanswered, unanswered, () => Promise.resolve({ kind: "found", session: session("s-1") })]);

    await resolver.follow(scope, { kind: "asking", sessionId: "s-1" });
    await settle();
    await fire();
    await fire();

    expect({ published, opened, waits: timers.map((timer) => timer.ms) }).toEqual({ published: ["asking", "unknown", "unknown"], opened: ["s-1"], waits: [1000, 2000] });
  });

  it("dates an unanswered target from its first miss, so the app row's grace is not restarted by each retry", async () => {
    const { resolver, unansweredSince, clock, fire } = harness([unanswered, unanswered, missing]);

    await resolver.follow(scope, { kind: "asking", sessionId: "s-1" });
    await settle();
    clock.now = 9_000;
    await fire();
    await fire();

    expect(unansweredSince).toEqual([undefined, 5_000, 5_000, undefined]);
  });

  it("reports a session that fails to open after a retry instead of losing the failure", async () => {
    const { resolver, reported, fire } = harness([unanswered, () => Promise.resolve({ kind: "found", session: session("fails-to-open") })]);

    await resolver.follow(scope, { kind: "asking", sessionId: "s-1" });
    await settle();
    await fire();

    expect(reported).toEqual(["the transcript read failed"]);
  });

  it("forgets a target once the reader goes elsewhere: a late answer changes nothing and no retry is left", async () => {
    let answer: (location: SessionLocation) => void = () => undefined;
    const { resolver, published, opened, timers } = harness([() => new Promise((resolve) => { answer = resolve; })]);

    const following = resolver.follow(scope, { kind: "asking", sessionId: "s-1" });
    resolver.drop();
    answer({ kind: "found", session: session("s-1") });
    await following;

    expect({ published, opened, pendingRetries: timers.filter((timer) => !timer.cancelled).length }).toEqual({ published: ["asking", undefined], opened: [], pendingRetries: 0 });
  });

  it("cancels a scheduled retry when dropped", async () => {
    const { resolver, timers } = harness([unanswered]);

    await resolver.follow(scope, { kind: "asking", sessionId: "s-1" });
    await settle();
    resolver.drop();

    expect(timers.map((timer) => timer.cancelled)).toEqual([true]);
  });

  it("publishes a target it cannot open, and opens nothing in its place", async () => {
    const { resolver, published, opened } = harness([]);

    await resolver.follow(scope, { kind: "folder-gone", session: session("s-1", { cwdMissing: true }) });

    expect({ published, opened }).toEqual({ published: ["folder-gone"], opened: [] });
  });
});
