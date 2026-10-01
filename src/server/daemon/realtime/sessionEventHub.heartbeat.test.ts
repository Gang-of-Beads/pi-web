import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { heartbeatIntervalMs, SessionEventHub, type RealtimeSocket } from "./sessionEventHub.js";

/**
 * The heartbeat is what lets a quiet page tell "nothing happened" from "I missed it".
 *
 * Owner, 2026-09-30: a page pulls only when its quiet window T (default 15 s) passes with
 * nothing received, and the heartbeat must stay small. So a socket is sent one only after
 * it has itself been quiet for 0.6 T, and it carries the stream position and transcript
 * head under `head` - never a top-level `seq`, which the page's gap repair would take for
 * the missed frame itself (docs/design/sync-convergence.md, phase A).
 */

class FakeSocket extends EventEmitter implements RealtimeSocket {
  readonly OPEN = 1;
  readyState = this.OPEN;
  bufferedAmount = 0;
  send = vi.fn();
  terminate = vi.fn();
}

function keepalives(socket: FakeSocket): unknown[] {
  return socket.send.mock.calls.flatMap(([payload]): unknown[] => {
    const frame: unknown = JSON.parse(String(payload));
    return typeof frame === "object" && frame !== null && Reflect.get(frame, "type") === "keepalive" ? [frame] : [];
  });
}

function clockedHub() {
  let now = 0;
  const hub = new SessionEventHub({ now: () => now });
  return { hub, at: (ms: number) => { now = ms; hub.heartbeatTick(); } };
}

describe("heartbeatIntervalMs", () => {
  it.each([
    { quietMs: undefined, interval: 20_000 },
    { quietMs: 15_000, interval: 9_000 },
    { quietMs: 1_000, interval: 3_000 },
    { quietMs: 100_000, interval: 20_000 },
    { quietMs: Number.NaN, interval: 20_000 },
  ])("a page quiet window of $quietMs ms gets a heartbeat every $interval ms", ({ quietMs, interval }) => {
    expect(heartbeatIntervalMs(quietMs)).toBe(interval);
  });
});

describe("SessionEventHub heartbeat", () => {
  it("waits until the socket itself has been quiet for its interval", () => {
    const { hub, at } = clockedHub();
    const socket = new FakeSocket();
    hub.add("s1", socket, { quietMs: 15_000 });
    at(1_000);
    hub.publish("s1", { type: "agent.start" });
    at(9_000);
    expect(keepalives(socket)).toHaveLength(0);
    at(10_000);
    expect(keepalives(socket)).toHaveLength(1);
  });

  it("carries the stream position and transcript head under head, with no top-level seq", () => {
    const { hub, at } = clockedHub();
    hub.setTranscriptHeadSource((sessionId) => (sessionId === "s1" ? { n: 3, leaf: "a1" } : undefined));
    const socket = new FakeSocket();
    hub.add("s1", socket, { quietMs: 15_000 });
    hub.publish("s1", { type: "agent.start" });
    at(9_000);
    const [frame] = keepalives(socket);
    expect(frame).toEqual({ type: "keepalive", head: { seq: 1, epoch: hub.currentEpoch("s1"), n: 3, leaf: "a1" } });
  });

  it("stays the plain keepalive for a session with nothing to report", () => {
    const { hub, at } = clockedHub();
    const socket = new FakeSocket();
    hub.add("s1", socket);
    at(20_000);
    expect(keepalives(socket)).toEqual([{ type: "keepalive" }]);
    expect(hub.currentSeq("s1")).toBe(0);
  });

  it("keeps the 20 s heartbeat for a page that names no quiet window", () => {
    const { hub, at } = clockedHub();
    const socket = new FakeSocket();
    hub.add("s1", socket);
    at(19_000);
    expect(keepalives(socket)).toHaveLength(0);
    at(20_000);
    expect(keepalives(socket)).toHaveLength(1);
  });

  it("sends one heartbeat per quiet interval, not one per tick", () => {
    const { hub, at } = clockedHub();
    const socket = new FakeSocket();
    hub.add("s1", socket, { quietMs: 5_000 });
    for (let ms = 1_000; ms <= 12_000; ms += 1_000) at(ms);
    expect(keepalives(socket)).toHaveLength(4);
  });

  it("gives machine-wide subscribers the keepalive with the global head on the default interval", () => {
    const { hub, at } = clockedHub();
    const socket = new FakeSocket();
    hub.addGlobal(socket);
    at(20_000);
    expect(keepalives(socket)).toEqual([{ type: "keepalive", head: { seq: 0 } }]);
  });
});

function sentFrames(socket: FakeSocket): unknown[] {
  return socket.send.mock.calls.map(([payload]): unknown => JSON.parse(String(payload)));
}

describe("a lost global announcement is noticeable (state-diagram D5, B28 slice H1)", () => {
  it("stamps the join frame with the current global seq, so the first frame after it has a baseline", () => {
    const { hub } = clockedHub();
    hub.setGlobalJoinFrame(() => ({ type: "pins.changed" }));
    hub.publishRealtime({ type: "pins.changed" });
    hub.publishRealtime({ type: "pins.changed" });
    const socket = new FakeSocket();
    hub.addGlobal(socket);
    hub.publishRealtime({ type: "pins.changed" });

    expect(sentFrames(socket).map((frame): unknown => Reflect.get(Object(frame), "seq"))).toEqual([2, 3]);
  });

  it("carries the last seq stamped on any global frame, a notification summary included, on the keepalive", () => {
    const { hub, at } = clockedHub();
    const socket = new FakeSocket();
    hub.addGlobal(socket);
    hub.publishRealtime({ type: "pins.changed" });
    hub.publishNotificationSummary({ type: "notifications.summary", daemonInstanceId: "d1", catalogRevision: 1, summary: { sessionId: "s1", cwd: "/repo", inboxRevision: 1, retainedCount: 1, discardedCount: 0 } });
    at(25_000);

    expect(sentFrames(socket).at(-1)).toEqual({ type: "keepalive", head: { seq: 2 } });
  });
});
