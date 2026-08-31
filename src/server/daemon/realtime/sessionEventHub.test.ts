import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SessionEventHub, replayDecision, type RealtimeSocket } from "./sessionEventHub.js";

class FakeSocket extends EventEmitter implements RealtimeSocket {
  readonly OPEN = 1;
  readyState = this.OPEN;
  send = vi.fn();
  terminate = vi.fn();
}

/** One field off a serialized frame, typed so eslint's any rules stay quiet. */
function frameField(frame: string, key: string): unknown {
  const parsed: unknown = JSON.parse(frame);
  if (typeof parsed !== "object" || parsed === null) return undefined;
  return Reflect.get(parsed, key);
}

describe("SessionEventHub keepalive", () => {
  // Without traffic there is no way for a browser to tell a quiet connection
  // from a dead one, and a connection dropped by a proxy without a FIN stays
  // OPEN in the browser forever. The keepalive exists to make silence provable.
  it("sends a keepalive to session and global subscribers alike", () => {
    const hub = new SessionEventHub();
    const sessionSocket = new FakeSocket();
    const globalSocket = new FakeSocket();
    hub.add("s1", sessionSocket);
    hub.addGlobal(globalSocket);
    globalSocket.send.mockClear();

    hub.sendKeepalive();

    expect(sessionSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "keepalive" }));
    expect(globalSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "keepalive" }));
  });

  it("does not consume sequence numbers", () => {
    // seq is the join-time watermark for replaying a stream; a keepalive is not
    // an event and must not move it, or a client would drop real events as
    // already-seen.
    const hub = new SessionEventHub();
    const socket = new FakeSocket();
    hub.add("s1", socket);

    hub.sendKeepalive();

    expect(hub.currentSeq("s1")).toBe(0);
  });

  it("stops sending once stopped", () => {
    const hub = new SessionEventHub();
    const socket = new FakeSocket();
    hub.add("s1", socket);
    hub.startKeepalive(1);
    hub.stopKeepalive();
    socket.send.mockClear();

    hub.startKeepalive(1);
    hub.stopKeepalive();

    expect(socket.send).not.toHaveBeenCalled();
  });
});

describe("replayDecision", () => {
  // The states a replay request can be in, enumerated: each gets one pin, so
  // adding a state without an answer fails here instead of in production.
  it("classifies every request state", () => {
    expect(replayDecision(undefined, 0)).toBe("caught-up");
    expect(replayDecision(undefined, 4)).toBe("unknown-session");
    expect(replayDecision([1, 2, 3], 5)).toBe("unknown-session");
    expect(replayDecision([1, 2, 3], 3)).toBe("caught-up");
    expect(replayDecision([3, 4, 5], 1)).toBe("out-of-reach");
    expect(replayDecision([2, 3, 4], 1)).toBe("replayable");
  });
});

describe("SessionEventHub replay", () => {
  /**
   * The client counts gaps against the seq stamp; section 3 turns a counted
   * gap into a repair. The hub keeps a bounded ring of recent per-session
   * frames so the daemon can hand back exactly what was missed instead of
   * making the browser resync the whole transcript for one dropped frame.
   */
  it("replays exactly the missed range with their stamps", () => {
    const hub = new SessionEventHub();
    hub.publish("s1", { type: "assistant.delta", text: "a" });
    hub.publish("s1", { type: "assistant.delta", text: "b" });
    hub.publish("s1", { type: "assistant.delta", text: "c" });

    const missed = hub.replaySince("s1", 1);

    expect(missed.verdict).toBe("replay");
    expect(missed.frames.map((frame) => frameField(frame, "text"))).toEqual(["b", "c"]);
    expect(missed.frames.map((frame) => frameField(frame, "seq"))).toEqual([2, 3]);
  });

  it("keeps frames published while nobody listened replayable", () => {
    const hub = new SessionEventHub();
    hub.publish("s1", { type: "assistant.delta", text: "unobserved" });
    hub.publish("s1", { type: "assistant.delta", text: "seen" });

    const missed = hub.replaySince("s1", 0);

    expect(missed.verdict).toBe("replay");
    expect(missed.frames.map((frame) => frameField(frame, "text"))).toEqual(["unobserved", "seen"]);
  });

  it("falls back to resync when the ring no longer reaches the requested seq", () => {
    const hub = new SessionEventHub({ replayBufferLimit: 3 });
    for (const text of ["1", "2", "3", "4", "5"]) hub.publish("s1", { type: "assistant.delta", text });

    expect(hub.replaySince("s1", 1).verdict).toBe("resync");
    // The buffer still reaches a recent seq.
    expect(hub.replaySince("s1", 3).verdict).toBe("replay");
  });

  it("drops delivery when armed but keeps the frame replayable", () => {
    const hub = new SessionEventHub();
    const sessionSocket = new FakeSocket();
    hub.add("s1", sessionSocket);

    hub.publish("s1", { type: "assistant.delta", text: "arrives" });
    hub.debugDropNext("s1", 1);
    hub.publish("s1", { type: "assistant.delta", text: "dropped" });
    hub.publish("s1", { type: "assistant.delta", text: "arrives-too" });

    const sent = sessionSocket.send.mock.calls.map((call) => frameField(String(call[0]), "text"));
    expect(sent).toEqual(["arrives", "arrives-too"]);
    const missed = hub.replaySince("s1", 1);
    expect(missed.verdict).toBe("replay");
    expect(missed.frames.map((frame) => frameField(frame, "text"))).toEqual(["dropped", "arrives-too"]);
  });

  it("answers an unknown session or a fresh client with an empty replay", () => {
    const hub = new SessionEventHub();
    expect(hub.replaySince("ghost", 0)).toEqual({ verdict: "replay", frames: [] });
    expect(hub.replaySince("ghost", 4).verdict).toBe("resync");
  });
});

describe("SessionEventHub", () => {
  it("publishes session events only to sockets for that session", () => {
    const hub = new SessionEventHub();
    const sessionSocket = new FakeSocket();
    const otherSocket = new FakeSocket();
    hub.add("s1", sessionSocket);
    hub.add("s2", otherSocket);

    hub.publish("s1", { type: "assistant.delta", text: "hello" });

    expect(sessionSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "assistant.delta", text: "hello", seq: 1 }));
    expect(otherSocket.send).not.toHaveBeenCalled();
  });

  it("keeps notification inbox events session-scoped and sequence-stamped", () => {
    const hub = new SessionEventHub();
    const sessionSocket = new FakeSocket();
    const otherSocket = new FakeSocket();
    hub.add("s1", sessionSocket);
    hub.add("s2", otherSocket);
    const notification = { id: "daemon-test:1", message: "notice", truncated: false, severity: "warning" as const, receivedAt: "2026-01-01T00:00:00.000Z", order: 1 };
    const summary = { sessionId: "s1", cwd: "/workspace", inboxRevision: 1, retainedCount: 1, discardedCount: 0, highestSeverity: "warning" as const };

    hub.publish("s1", {
      type: "notifications.inbox",
      daemonInstanceId: "daemon-test",
      catalogRevision: 1,
      summary,
      dismissThrough: { order: 1, overflowWatermark: 0 },
      delta: { kind: "added", notification },
    });

    expect(sessionSocket.send).toHaveBeenCalledWith(JSON.stringify({
      type: "notifications.inbox",
      daemonInstanceId: "daemon-test",
      catalogRevision: 1,
      summary,
      dismissThrough: { order: 1, overflowWatermark: 0 },
      delta: { kind: "added", notification },
      seq: 1,
    }));
    expect(otherSocket.send).not.toHaveBeenCalled();
  });

  it("omits thinking signatures from final-message payloads without mutating source events", () => {
    const hub = new SessionEventHub();
    const socket = new FakeSocket();
    hub.add("s1", socket);
    const thinkingBlock = { type: "thinking", thinking: "private chain", thinkingSignature: "opaque-provider-payload", redacted: true };
    const message = { role: "assistant", content: [thinkingBlock, { type: "text", text: "visible answer" }] };

    hub.publish("s1", { type: "message.end", message });

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      type: "message.end",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "private chain", redacted: true }, { type: "text", text: "visible answer" }] },
      seq: 1,
    }));
    expect(thinkingBlock.thinkingSignature).toBe("opaque-provider-payload");
  });

  it("removes session sockets on close and skips non-open sockets", () => {
    const hub = new SessionEventHub();
    const closed = new FakeSocket();
    const removed = new FakeSocket();
    closed.readyState = 3;
    hub.add("s1", closed);
    hub.add("s1", removed);
    removed.emit("close");

    hub.publish("s1", { type: "session.error", message: "boom" });

    expect(closed.send).not.toHaveBeenCalled();
    expect(removed.send).not.toHaveBeenCalled();
  });

  it("terminates a failed session socket without disrupting healthy delivery or sequence watermarks", () => {
    const hub = new SessionEventHub();
    const failed = new FakeSocket();
    const healthy = new FakeSocket();
    failed.send.mockImplementation(() => { throw new Error("socket closed"); });
    hub.add("s1", failed);
    hub.add("s1", healthy);

    hub.publish("s1", { type: "assistant.delta", text: "hello" });

    expect(failed.send).toHaveBeenCalledOnce();
    expect(failed.terminate).toHaveBeenCalledOnce();
    expect(healthy.send).toHaveBeenCalledWith(JSON.stringify({ type: "assistant.delta", text: "hello", seq: 1 }));
    expect(hub.currentSeq("s1")).toBe(1);

    failed.send.mockClear();
    hub.publish("s1", { type: "assistant.delta", text: "again" });

    expect(failed.send).not.toHaveBeenCalled();
    expect(failed.terminate).toHaveBeenCalledOnce();
    expect(healthy.send).toHaveBeenLastCalledWith(JSON.stringify({ type: "assistant.delta", text: "again", seq: 2 }));
    expect(hub.currentSeq("s1")).toBe(2);
  });

  it("publishes global events only to global sockets", () => {
    const hub = new SessionEventHub();
    const globalSocket = new FakeSocket();
    const sessionSocket = new FakeSocket();
    hub.addGlobal(globalSocket);
    hub.add("s1", sessionSocket);

    const status = {
      sessionId: "s1",
      isStreaming: false,
      isCompacting: false,
      isBashRunning: false,
      pendingMessageCount: 0,
      queuedMessages: [],
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    };

    hub.publishGlobal({ type: "status.update", status });

    expect(globalSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "status.update", status, seq: 1 }));
    expect(sessionSocket.send).not.toHaveBeenCalled();
  });

  it("publishes authoritative unread deltas only to global sockets", () => {
    const hub = new SessionEventHub();
    const globalSocket = new FakeSocket();
    const sessionSocket = new FakeSocket();
    hub.addGlobal(globalSocket);
    hub.add("s1", sessionSocket);
    const event = {
      type: "sessions.unread" as const,
      catalogId: "catalog-test",
      catalogRevision: 3,
      sessionId: "s1",
      cwd: "/workspace",
      unread: { sessionId: "s1", cwd: "/workspace", completionOrder: 2, completedAt: "2026-07-20T00:00:00.000Z" },
    };

    hub.publishGlobal(event);

    expect(globalSocket.send).toHaveBeenCalledWith(JSON.stringify({ ...event, seq: 1 }));
    expect(sessionSocket.send).not.toHaveBeenCalled();
  });

  it("publishes notification summaries only to global sockets", () => {
    const hub = new SessionEventHub();
    const globalSocket = new FakeSocket();
    const sessionSocket = new FakeSocket();
    hub.addGlobal(globalSocket);
    hub.add("s1", sessionSocket);
    const summary = { sessionId: "s1", cwd: "/workspace", inboxRevision: 1, retainedCount: 1, discardedCount: 0, highestSeverity: "warning" as const };

    hub.publishNotificationSummary({
      type: "notifications.summary",
      daemonInstanceId: "daemon-test",
      catalogRevision: 1,
      summary,
    });

    expect(globalSocket.send).toHaveBeenCalledWith(JSON.stringify({
      type: "notifications.summary",
      daemonInstanceId: "daemon-test",
      catalogRevision: 1,
      summary,
      seq: 1,
    }));
    expect(sessionSocket.send).not.toHaveBeenCalled();
  });

  it("contains termination failures while publishing stamped global events", () => {
    const hub = new SessionEventHub();
    const failed = new FakeSocket();
    const healthy = new FakeSocket();
    failed.send.mockImplementation(() => { throw new Error("socket closed"); });
    failed.terminate.mockImplementation(() => { throw new Error("termination failed"); });
    hub.addGlobal(failed);
    hub.addGlobal(healthy);

    hub.publishGlobal({ type: "session.name", sessionId: "s1", name: "Renamed" });

    expect(failed.send).toHaveBeenCalledOnce();
    expect(failed.terminate).toHaveBeenCalledOnce();
    expect(healthy.send).toHaveBeenCalledWith(JSON.stringify({ type: "session.name", sessionId: "s1", name: "Renamed", seq: 1 }));

    failed.send.mockClear();
    hub.publishGlobal({ type: "session.name", sessionId: "s1", name: "Renamed again" });

    expect(failed.send).not.toHaveBeenCalled();
    expect(failed.terminate).toHaveBeenCalledOnce();
    expect(healthy.send).toHaveBeenLastCalledWith(JSON.stringify({ type: "session.name", sessionId: "s1", name: "Renamed again", seq: 2 }));
  });

  it("stamps a monotonically increasing per-session seq on published events", () => {
    const hub = new SessionEventHub();
    const socket = new FakeSocket();
    hub.add("s1", socket);

    hub.publish("s1", { type: "assistant.delta", text: "a" });
    hub.publish("s1", { type: "assistant.delta", text: "b" });
    hub.publish("s1", { type: "assistant.delta", text: "c" });

    expect(socket.send).toHaveBeenNthCalledWith(1, JSON.stringify({ type: "assistant.delta", text: "a", seq: 1 }));
    expect(socket.send).toHaveBeenNthCalledWith(2, JSON.stringify({ type: "assistant.delta", text: "b", seq: 2 }));
    expect(socket.send).toHaveBeenNthCalledWith(3, JSON.stringify({ type: "assistant.delta", text: "c", seq: 3 }));
  });

  it("advances seq even when no sockets are attached so the watermark stays accurate", () => {
    const hub = new SessionEventHub();

    hub.publish("s1", { type: "assistant.delta", text: "a" });
    hub.publish("s1", { type: "assistant.delta", text: "b" });

    expect(hub.currentSeq("s1")).toBe(2);

    const socket = new FakeSocket();
    hub.add("s1", socket);
    hub.publish("s1", { type: "assistant.delta", text: "c" });

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "assistant.delta", text: "c", seq: 3 }));
  });

  it("tracks seq independently per session", () => {
    const hub = new SessionEventHub();
    const s1 = new FakeSocket();
    const s2 = new FakeSocket();
    hub.add("s1", s1);
    hub.add("s2", s2);

    hub.publish("s1", { type: "assistant.delta", text: "a" });
    hub.publish("s1", { type: "assistant.delta", text: "b" });
    hub.publish("s2", { type: "assistant.delta", text: "x" });

    expect(hub.currentSeq("s1")).toBe(2);
    expect(hub.currentSeq("s2")).toBe(1);
    expect(s1.send).toHaveBeenLastCalledWith(JSON.stringify({ type: "assistant.delta", text: "b", seq: 2 }));
    expect(s2.send).toHaveBeenCalledWith(JSON.stringify({ type: "assistant.delta", text: "x", seq: 1 }));
  });

  it("hands the join frame to each global subscriber as it joins, and to no one else", () => {
    const hub = new SessionEventHub();
    const early = new FakeSocket();
    hub.addGlobal(early);
    const frame = { type: "session.name", sessionId: "s1", name: "Joined" } as const;
    hub.setGlobalJoinFrame(() => frame);
    const late = new FakeSocket();
    const sessionSocket = new FakeSocket();

    hub.addGlobal(late);
    hub.add("s1", sessionSocket);

    expect(late.send).toHaveBeenCalledWith(JSON.stringify(frame));
    // The frame belongs to the joining socket only: an already-connected
    // subscriber has the state and a per-session socket never carries it.
    expect(early.send).not.toHaveBeenCalled();
    expect(sessionSocket.send).not.toHaveBeenCalled();
  });

  it("drops a global socket that fails on its join frame", () => {
    const hub = new SessionEventHub();
    const failed = new FakeSocket();
    failed.send.mockImplementation(() => { throw new Error("socket closed"); });
    hub.setGlobalJoinFrame(() => ({ type: "session.name", sessionId: "s1", name: "Joined" }));

    hub.addGlobal(failed);
    hub.publishGlobal({ type: "session.name", sessionId: "s1", name: "Renamed" });

    expect(failed.terminate).toHaveBeenCalledOnce();
    expect(failed.send).toHaveBeenCalledOnce();
  });

  it("reports zero seq for a session that has never published", () => {
    const hub = new SessionEventHub();
    expect(hub.currentSeq("never")).toBe(0);
  });

  it("stamps realtime and notification-summary frames with one shared global seq", () => {
    const hub = new SessionEventHub();
    const globalSocket = new FakeSocket();
    hub.addGlobal(globalSocket);
    const summary = { sessionId: "s1", cwd: "/workspace", inboxRevision: 1, retainedCount: 1, discardedCount: 0, highestSeverity: "warning" as const };

    hub.publishGlobal({ type: "session.name", sessionId: "s1", name: "Renamed" });
    hub.publishNotificationSummary({ type: "notifications.summary", daemonInstanceId: "daemon-test", catalogRevision: 1, summary });
    hub.publishGlobal({ type: "session.name", sessionId: "s1", name: "Renamed again" });

    // One counter for the one global scope: the summary is not a second
    // sequence, or a gap in one surface would say nothing about the other.
    expect(globalSocket.send).toHaveBeenNthCalledWith(1, JSON.stringify({ type: "session.name", sessionId: "s1", name: "Renamed", seq: 1 }));
    expect(globalSocket.send).toHaveBeenNthCalledWith(2, JSON.stringify({ type: "notifications.summary", daemonInstanceId: "daemon-test", catalogRevision: 1, summary, seq: 2 }));
    expect(globalSocket.send).toHaveBeenNthCalledWith(3, JSON.stringify({ type: "session.name", sessionId: "s1", name: "Renamed again", seq: 3 }));
  });

  it("advances the global seq even with no subscriber, so a late joiner sees consecutive numbers", () => {
    const hub = new SessionEventHub();
    const summary = { sessionId: "s1", cwd: "/workspace", inboxRevision: 1, retainedCount: 0, discardedCount: 0, highestSeverity: "info" as const };

    hub.publishGlobal({ type: "session.name", sessionId: "s1", name: "Renamed" });
    hub.publishNotificationSummary({ type: "notifications.summary", daemonInstanceId: "daemon-test", catalogRevision: 1, summary });

    expect(hub.currentGlobalSeq()).toBe(2);

    const socket = new FakeSocket();
    hub.addGlobal(socket);
    hub.publishGlobal({ type: "session.name", sessionId: "s1", name: "Third" });

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "session.name", sessionId: "s1", name: "Third", seq: 3 }));
  });
});
