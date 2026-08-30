import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeSocket, SessionSocket, parseRealtimeSocketEvent, parseSessionSocketEvent, jitteredReconnectDelay, revisionedFrameType } from "./sessionSocket";

function notification(order = 1) {
  return {
    id: `daemon-a:${String(order)}`,
    message: "notice",
    truncated: false,
    severity: "info",
    receivedAt: "2026-07-18T00:00:00.000Z",
    order,
  };
}

function summary() {
  return {
    sessionId: "session-1",
    cwd: "/repo",
    inboxRevision: 1,
    retainedCount: 1,
    discardedCount: 0,
    highestSeverity: "info",
  };
}

function inboxEvent() {
  return {
    type: "notifications.inbox",
    daemonInstanceId: "daemon-a",
    catalogRevision: 1,
    summary: summary(),
    dismissThrough: { order: 1, overflowWatermark: 0 },
    delta: { kind: "added", notification: notification() },
  };
}

describe("a malformed frame on a revisioned surface is a gap, not a silent drop", () => {
  // A dialog/ask/inbox frame that fails validation used to vanish without a
  // trace: the surface's revision never advanced, so the next valid frame
  // applied cleanly on top of a state missing one transition - the same stale
  // card the lost-frame repair exists for, reached through a different door.
  // The socket now names the surface so the owner can request its resync.
  it("names the revisioned surface behind a frame", () => {
    expect(revisionedFrameType({ type: "dialog.opened", dialog: { bogus: true } })).toBe("dialog.opened");
    expect(revisionedFrameType({ type: "dialog.closed" })).toBe("dialog.closed");
    expect(revisionedFrameType({ type: "ask.opened" })).toBe("ask.opened");
    expect(revisionedFrameType({ type: "ask.closed" })).toBe("ask.closed");
    expect(revisionedFrameType({ type: "notifications.inbox" })).toBe("notifications.inbox");
  });

  it("does not treat stream vocabulary or keepalives as revisioned surfaces", () => {
    expect(revisionedFrameType({ type: "keepalive" })).toBeUndefined();
    expect(revisionedFrameType({ type: "message" })).toBeUndefined();
    expect(revisionedFrameType({})).toBeUndefined();
    expect(revisionedFrameType(undefined)).toBeUndefined();
  });
});

describe("connection liveness", () => {
  // A proxy or NAT that drops a silent connection without a FIN leaves the
  // browser's socket OPEN forever: onclose never fires, the reconnect that
  // refetches state never runs, and the page only updates when someone reloads
  // it by hand. The daemon sends a keepalive every 20s precisely so that a gap
  // in traffic is evidence rather than ambiguity.
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
    vi.stubGlobal("window", { clearTimeout: vi.fn(), setTimeout: vi.fn(() => 1) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops a session socket that has been silent past the keepalive budget", () => {
    const session = new SessionSocket();
    session.connect({ id: "session-1", cwd: "/repo" }, () => undefined);
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error("expected a session socket");
    socket.onopen?.();

    session.checkLiveness(Date.now() + 60_000);

    expect(socket.readyState).toBe(3);
  });

  it("leaves a session socket alone while frames are still arriving", () => {
    const session = new SessionSocket();
    session.connect({ id: "session-1", cwd: "/repo" }, () => undefined);
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error("expected a session socket");
    socket.onopen?.();
    // Any frame counts as proof of life, including the keepalive, which parses
    // to no event and is dropped.
    socket.onmessage?.({ data: JSON.stringify({ type: "keepalive" }) });

    session.checkLiveness(Date.now() + 10_000);

    expect(socket.readyState).toBe(1);
  });

  it("drops a silent realtime socket too", () => {
    const realtime = new RealtimeSocket();
    realtime.connect(() => undefined);
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error("expected a realtime socket");
    socket.onopen?.();

    realtime.checkLiveness(Date.now() + 60_000);

    expect(socket.readyState).toBe(3);
  });

  it("does nothing for a socket that was never opened", () => {
    // Nothing to prove dead: connect() has not resolved, so silence is expected
    // and closing here would fight the initial handshake.
    const session = new SessionSocket();
    session.connect({ id: "session-1", cwd: "/repo" }, () => undefined);
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error("expected a session socket");

    session.checkLiveness(Date.now() + 60_000);

    expect(socket.readyState).toBe(1);
  });
});

describe("notification socket guards", () => {
  it("accepts validated selected-session events and drops global notification summaries", () => {
    expect(parseSessionSocketEvent(inboxEvent())).toMatchObject({ type: "notifications.inbox", delta: { kind: "added" } });

    expect(parseRealtimeSocketEvent({
      type: "notifications.summary",
      daemonInstanceId: "daemon-a",
      catalogRevision: 1,
      summary: summary(),
    })).toBeUndefined();
  });

  it("ignores malformed notification events instead of widening type-only acceptance", () => {
    expect(parseSessionSocketEvent({
      type: "notifications.inbox",
      daemonInstanceId: "daemon-a",
      catalogRevision: 1,
      summary: { ...summary(), highestSeverity: "fatal" },
      dismissThrough: { order: 1, overflowWatermark: 0 },
      delta: { kind: "added", notification: notification() },
    })).toBeUndefined();
  });

  it("accepts only strictly validated global unread deltas", () => {
    const unread = {
      sessionId: "session-1",
      cwd: "/repo",
      completionOrder: 1,
      completedAt: "2026-07-20T00:00:01.000Z",
    };
    expect(parseRealtimeSocketEvent({
      type: "sessions.unread",
      catalogId: "catalog-a",
      catalogRevision: 1,
      sessionId: unread.sessionId,
      cwd: unread.cwd,
      unread,
    })).toMatchObject({ type: "sessions.unread", unread });
    expect(parseRealtimeSocketEvent({
      type: "sessions.unread",
      catalogId: "catalog-a",
      catalogRevision: 1,
      sessionId: "other-session",
      cwd: unread.cwd,
      unread,
    })).toBeUndefined();
    expect(parseRealtimeSocketEvent({
      type: "sessions.unread",
      catalogId: "catalog-a",
      catalogRevision: 3.5,
      sessionId: unread.sessionId,
      cwd: unread.cwd,
      unread: null,
    })).toBeUndefined();
  });

  it("carries the startup marker through the socket boundary, marker and all", () => {
    const activity = { sessionId: "session-1", phase: "active", label: "Opening session", detail: "Starting the Pi session", at: "2026-07-20T00:00:01.000Z", startup: true };

    // The marker is what stops an opening session being treated as a working
    // one, so dropping it in transit would restore the defect for every frame,
    // including those relayed from a remote machine.
    expect(parseRealtimeSocketEvent({ type: "session.startup", activity })).toMatchObject({ type: "session.startup", activity: { startup: true } });
    expect(parseRealtimeSocketEvent({ type: "session.startup", activity: { ...activity, startup: 1 } })).toBeUndefined();
  });

  it("accepts validated session startup progress and drops malformed frames", () => {
    const activity = { sessionId: "session-1", phase: "active", label: "Creating session", detail: "Starting the Pi session", at: "2026-07-20T00:00:01.000Z" };

    expect(parseRealtimeSocketEvent({ type: "session.startup", startupToken: "pending-session-1-abc", activity }))
      .toMatchObject({ type: "session.startup", startupToken: "pending-session-1-abc", activity });
    expect(parseRealtimeSocketEvent({ type: "session.startup", activity })).toMatchObject({ type: "session.startup", activity });
    expect(parseRealtimeSocketEvent({ type: "session.startup", startupToken: "", activity })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "session.startup" })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "session.startup", activity: { ...activity, phase: "waiting" } })).toBeUndefined();
    // Startup progress is global-only, so it must not be accepted as a
    // per-session frame even when it is well formed.
    expect(parseSessionSocketEvent({ type: "session.startup", activity })).toBeUndefined();
  });

  /**
   * The server stamps every interactive-surface frame with the surface's
   * monotonic revision; the lost-frame repair compares those stamps. A parser
   * that rebuilds the event and drops the stamp silently disarms the whole
   * repair - which is exactly what shipped: the repair's tests fed the scope
   * hand-built events, while production frames arrived stripped.
   */
  it("carries the surface revision through ask and dialog validation", () => {
    const ask = {
      askId: "ask-1",
      askedAt: "2026-07-20T00:00:00.000Z",
      questions: [{ id: "q1", question: "Which database?", options: [{ value: "pg", label: "Postgres" }] }],
    };
    const dialog = {
      dialogId: "dialog-1",
      kind: "select",
      title: "Pick a database",
      options: ["Postgres", "SQLite"],
      askedAt: "2026-07-20T00:00:00.000Z",
      runScoped: true,
    };

    expect(parseSessionSocketEvent({ type: "ask.opened", ask, revision: 4, daemonInstanceId: "daemon-a" })).toMatchObject({ revision: 4, daemonInstanceId: "daemon-a" });
    expect(parseSessionSocketEvent({ type: "ask.closed", askId: "ask-1", reason: "superseded", revision: 5 })).toMatchObject({ revision: 5 });
    expect(parseSessionSocketEvent({ type: "dialog.opened", dialog, revision: 6 })).toMatchObject({ revision: 6 });
    expect(parseSessionSocketEvent({ type: "dialog.closed", dialogId: "dialog-1", reason: "timeout", revision: 7 })).toMatchObject({ revision: 7 });
    // A malformed stamp parses as absent - the frame still applies, fail-open.
    expect(parseSessionSocketEvent({ type: "ask.opened", ask, revision: "x" })).not.toHaveProperty("revision");
  });

  it("accepts validated ask frames and drops malformed ones", () => {
    const ask = {
      askId: "ask-1",
      askedAt: "2026-07-20T00:00:00.000Z",
      questions: [{ id: "q1", question: "Which database?", options: [{ value: "pg", label: "Postgres" }] }],
    };

    expect(parseSessionSocketEvent({ type: "ask.opened", ask })).toEqual({ type: "ask.opened", ask });
    expect(parseSessionSocketEvent({ type: "ask.closed", askId: "ask-1", reason: "superseded" }))
      .toEqual({ type: "ask.closed", askId: "ask-1", reason: "superseded" });
    expect(parseSessionSocketEvent({ type: "ask.opened", ask: { ...ask, questions: [] } })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "ask.opened" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "ask.closed", askId: "ask-1", reason: "ignored" })).toBeUndefined();
    // Ask frames are per-session only, so they must not be accepted globally.
    expect(parseRealtimeSocketEvent({ type: "ask.opened", ask })).toBeUndefined();
  });

  it("accepts validated dialog frames and drops malformed ones", () => {
    const dialog = {
      dialogId: "dialog-1",
      kind: "select",
      title: "Pick a database",
      options: ["Postgres", "SQLite"],
      askedAt: "2026-07-20T00:00:00.000Z",
      runScoped: true,
    };

    expect(parseSessionSocketEvent({ type: "dialog.opened", dialog })).toEqual({ type: "dialog.opened", dialog });
    expect(parseSessionSocketEvent({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered", answer: "SQLite" }))
      .toEqual({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered", answer: "SQLite" });
    expect(parseSessionSocketEvent({ type: "dialog.closed", dialogId: "dialog-1", reason: "timeout" }))
      .toEqual({ type: "dialog.closed", dialogId: "dialog-1", reason: "timeout" });
    expect(parseSessionSocketEvent({ type: "dialog.opened", dialog: { ...dialog, kind: "modal" } })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "dialog.opened" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "dialog.closed", dialogId: "dialog-1", reason: "ignored" })).toBeUndefined();
    // A close whose reason disagrees with its answer cannot be rendered honestly.
    expect(parseSessionSocketEvent({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "dialog.closed", dialogId: "dialog-1", reason: "cancelled", answer: true })).toBeUndefined();
    // Dialog frames are per-session only, so they must not be accepted globally.
    expect(parseRealtimeSocketEvent({ type: "dialog.opened", dialog })).toBeUndefined();
  });
});

function statusWire() {
  return {
    sessionId: "session-1",
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
    cost: 0.5,
  };
}

function activityWire() {
  return { sessionId: "session-1", phase: "active", label: "running bash", detail: "ls", at: "2026-07-20T00:00:01.000Z" };
}

function sessionInfoWire() {
  return {
    id: "session-1",
    path: "/repo/.pi/sessions/session-1.jsonl",
    cwd: "/repo",
    created: "2026-07-20T00:00:00.000Z",
    modified: "2026-07-20T00:00:01.000Z",
    messageCount: 2,
    firstMessage: "hello",
  };
}

function terminalInfoWire() {
  return { id: "terminal-1", cwd: "/repo", name: "bash", createdAt: "2026-07-20T00:00:00.000Z", exited: false };
}

function machineStatusWire() {
  return {
    epochId: "epoch-1",
    revision: 3,
    machine: { "core:working": true },
    projects: { "project-1": { "core:working": true } },
    workspaces: { "workspace-1": { "core:working": true } },
    unattributed: {},
    generatedAt: "2026-07-20T00:00:00.000Z",
  };
}

describe("socket stream validation", () => {
  it("accepts the full session stream vocabulary with valid payloads", () => {
    const validFrames = [
      { type: "message.append", message: { role: "user", content: [] } },
      { type: "assistant.delta", text: "hello" },
      { type: "assistant.thinking.delta", text: "thinking" },
      { type: "tool.start", toolName: "read", toolCallId: "call-1", summary: "read file", args: { path: "/a" } },
      { type: "tool.update", toolName: "read", toolCallId: "call-1", text: "partial", content: [], details: {} },
      { type: "tool.end", toolName: "read", toolCallId: "call-1", text: "done", isError: false },
      { type: "shell.start", command: "ls", excludeFromContext: true },
      { type: "shell.chunk", chunk: "out" },
      { type: "shell.end", output: "out", exitCode: 0, cancelled: false, truncated: false, fullOutputPath: "/tmp/out", isError: false },
      { type: "shell.end", exitCode: null },
      { type: "agent.start" },
      { type: "agent.end" },
      { type: "message.end", message: { role: "assistant" } },
      { type: "message.end" },
      { type: "status.update", status: statusWire() },
      { type: "activity.update", activity: activityWire() },
      { type: "command.output", level: "success", message: "done" },
      { type: "session.error", message: "boom" },
      { type: "session.name", sessionId: "session-1", name: "rename" },
      { type: "session.created", session: sessionInfoWire() },
      { type: "pi.event", eventType: "turn_start" },
    ];
    for (const frame of validFrames) expect(parseSessionSocketEvent(frame)).toEqual(frame);
  });

  it("drops malformed session stream frames instead of accepting them on type alone", () => {
    expect(parseSessionSocketEvent({ type: "message.append" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "assistant.delta" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "assistant.delta", text: 7 })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "assistant.thinking.delta", text: true })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "tool.start", toolName: "read", toolCallId: "call-1" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "tool.update", toolName: "read", toolCallId: "call-1", text: 4 })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "tool.end", toolName: "read", toolCallId: "call-1", text: "done" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "shell.start", command: "ls", excludeFromContext: "yes" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "shell.chunk", chunk: 8 })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "shell.end", exitCode: "0" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "shell.end", cancelled: "no" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "command.output", level: "verbose", message: "x" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "command.output", level: "info" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "session.error" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "session.name", name: "rename" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "session.name", sessionId: "" })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "session.created", session: { id: "session-1" } })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "pi.event", eventType: 9 })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "status.update", status: { sessionId: "session-1" } })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "activity.update", activity: { ...activityWire(), phase: "waiting" } })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "session.startup", activity: activityWire() })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "terminal.created", terminal: terminalInfoWire() })).toBeUndefined();
    expect(parseSessionSocketEvent({ type: "totally.unknown" })).toBeUndefined();
  });

  it("rebuilds stream frames from validated fields and carries the hub seq stamp", () => {
    // The join-time exactly-once filter reads seq, so validation must not strip
    // it; a non-numeric stamp fails open rather than dropping the frame.
    expect(parseSessionSocketEvent({ type: "assistant.delta", text: "hi", seq: 41, bogus: "dropped" }))
      .toEqual({ type: "assistant.delta", text: "hi", seq: 41 });
    expect(parseSessionSocketEvent({ type: "assistant.delta", text: "hi", seq: "41" }))
      .toEqual({ type: "assistant.delta", text: "hi" });
    expect(parseSessionSocketEvent({ type: "assistant.delta", text: "hi" }))
      .toEqual({ type: "assistant.delta", text: "hi" });
  });

  it("accepts the full realtime vocabulary with valid payloads", () => {
    const validFrames = [
      { type: "status.update", status: statusWire() },
      { type: "activity.update", activity: activityWire() },
      { type: "session.name", sessionId: "session-1", name: "rename" },
      { type: "session.created", session: sessionInfoWire() },
      { type: "terminal.created", terminal: terminalInfoWire() },
      { type: "terminal.exited", terminal: { ...terminalInfoWire(), exited: true, exitCode: 0 } },
      { type: "terminal.closed", terminalId: "terminal-1", cwd: "/repo" },
      { type: "machine.status", status: machineStatusWire() },
    ];
    for (const frame of validFrames) expect(parseRealtimeSocketEvent(frame)).toEqual(frame);
  });

  it("keeps unrecognised status flags so a newer daemon's tree still arrives", () => {
    // A federated machine may run a daemon that publishes flags this browser
    // does not know; the frame must survive and still carry them.
    expect(parseRealtimeSocketEvent({
      type: "machine.status",
      status: { ...machineStatusWire(), machine: { "core:working": true, "core:future": true, "core:broken": "yes" } },
    })).toEqual({
      type: "machine.status",
      status: { ...machineStatusWire(), machine: { "core:working": true, "core:future": true } },
    });
  });

  it("drops malformed realtime frames instead of accepting them on type alone", () => {
    expect(parseRealtimeSocketEvent({ type: "status.update", status: { sessionId: "session-1" } })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "activity.update", activity: { ...activityWire(), phase: "waiting" } })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "session.name", name: "rename" })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "session.created", session: {} })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "terminal.created", terminal: { id: "terminal-1" } })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "terminal.exited", terminal: null })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "terminal.closed", terminalId: "terminal-1" })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "terminal.closed", terminalId: "", cwd: "/repo" })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "machine.status", status: { ...machineStatusWire(), epochId: "" } })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "machine.status", status: { ...machineStatusWire(), projects: null } })).toBeUndefined();
    // Per-session stream frames are not accepted on the global socket.
    expect(parseRealtimeSocketEvent({ type: "assistant.delta", text: "hi" })).toBeUndefined();
    expect(parseRealtimeSocketEvent({ type: "future.notification", payload: {} })).toBeUndefined();
  });
});

describe("dark-launch seq gap counting", () => {
  // The hub stamps every frame with a monotonic seq, and until this change the
  // client compared it exactly once, at join. A frame lost to a dead-but-OPEN
  // socket or to a validation throw was invisible: the surfaces it carried kept
  // their stale values, which is the shape behind stuck cards and a count that
  // disagrees with its drawer. This counter makes loss visible before any
  // behaviour changes: gaps are counted and logged, nothing else.
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
    vi.stubGlobal("window", { clearTimeout: vi.fn(), setTimeout: vi.fn(() => 1) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function deliver(socket: FakeWebSocket, frame: unknown): Promise<void> {
    socket.onmessage?.({ data: JSON.stringify(frame) });
    // handleMessage is async: let the parse microtasks settle before asserting.
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }

  it("counts one gap when the session stream skips a frame, and applies every frame", async () => {
    const applied: unknown[] = [];
    const session = new SessionSocket();
    session.connect({ id: "session-1", cwd: "/repo" }, (event) => { applied.push(event); });
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error("expected a session socket");
    socket.onopen?.();

    await deliver(socket, { type: "assistant.delta", text: "a", seq: 1 });
    await deliver(socket, { type: "assistant.delta", text: "b", seq: 2 });
    await deliver(socket, { type: "assistant.delta", text: "c", seq: 4 });

    expect(session.gapCount).toBe(1);
    expect(applied).toHaveLength(3);
  });

  it("reports a gap with the pre-jump watermark before delivering the revealing frame", async () => {
    const applied: unknown[] = [];
    const gaps: number[] = [];
    const session = new SessionSocket();
    session.connect({ id: "session-1", cwd: "/repo" }, (event) => { applied.push(event); }, undefined, "local", undefined, undefined, (lastSeen) => { gaps.push(lastSeen); });
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error("expected a session socket");
    socket.onopen?.();

    await deliver(socket, { type: "assistant.delta", text: "a", seq: 1 });
    await deliver(socket, { type: "assistant.delta", text: "c", seq: 3 });

    // The callback fires before the revealing frame is delivered, so the
    // repair can hold it instead of applying it ahead of the missing ones.
    expect(gaps).toEqual([1]);
    expect(applied.map((event) => {
      const seq: unknown = typeof event === "object" && event !== null ? Reflect.get(event, "seq") : undefined;
      return seq;
    })).toEqual([1, 3]);
  });

  it("fails open: unstamped frames apply and are not counted as gaps", async () => {
    const applied: unknown[] = [];
    const session = new SessionSocket();
    session.connect({ id: "session-1", cwd: "/repo" }, (event) => { applied.push(event); });
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error("expected a session socket");
    socket.onopen?.();

    await deliver(socket, { type: "assistant.delta", text: "a", seq: 7 });
    // An unupgraded federation peer sends frames without a stamp; they must
    // flow exactly as they did before the counter existed.
    await deliver(socket, { type: "assistant.delta", text: "b" });
    await deliver(socket, { type: "assistant.delta", text: "c", seq: "9" });

    expect(session.gapCount).toBe(0);
    expect(applied).toHaveLength(3);
  });

  it("does not count a duplicate or late frame as a gap, nor rewind to it", async () => {
    const session = new SessionSocket();
    session.connect({ id: "session-1", cwd: "/repo" }, () => undefined);
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error("expected a session socket");
    socket.onopen?.();

    await deliver(socket, { type: "assistant.delta", text: "a", seq: 3 });
    // The watermark filter drops these at the controller; here they are only
    // evidence that nothing was lost, so they must not count as loss.
    await deliver(socket, { type: "assistant.delta", text: "a-again", seq: 3 });
    await deliver(socket, { type: "assistant.delta", text: "late", seq: 2 });
    await deliver(socket, { type: "assistant.delta", text: "b", seq: 4 });

    expect(session.gapCount).toBe(0);
  });

  it("baselines on the first stamped frame after an open, so a reconnect is not a gap", async () => {
    const session = new SessionSocket();
    session.connect({ id: "session-1", cwd: "/repo" }, () => undefined);
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error("expected a session socket");
    socket.onopen?.();
    await deliver(socket, { type: "assistant.delta", text: "a", seq: 40 });

    // A daemon restart resets the hub's counter to 1 and a reconnect refetches
    // everything; either way the first frame after an open says nothing about
    // loss, so counting across that boundary would log false gaps forever.
    socket.onopen?.();
    await deliver(socket, { type: "assistant.delta", text: "b", seq: 1 });
    await deliver(socket, { type: "assistant.delta", text: "c", seq: 3 });

    expect(session.gapCount).toBe(1);
  });

  it("counts gaps on the global scope from the same wire stamps", async () => {
    const applied: unknown[] = [];
    const realtime = new RealtimeSocket();
    realtime.connect((event) => { applied.push(event); });
    const socket = FakeWebSocket.instances[0];
    if (socket === undefined) throw new Error("expected a realtime socket");
    socket.onopen?.();

    await deliver(socket, { type: "session.name", sessionId: "s1", name: "a", seq: 1 });
    await deliver(socket, { type: "session.name", sessionId: "s1", name: "b", seq: 3 });

    expect(realtime.gapCount).toBe(1);
    expect(applied).toHaveLength(2);
  });
});

class FakeWebSocket {
  static readonly CONNECTING = 0;
  // The real constructor carries these, and liveness checks read WebSocket.OPEN
  // to tell "still connecting" from "connected but silent".
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];

  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: MessageEvent["data"] }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = 3;
  }
}

describe("socket instance isolation", () => {
  const setTimeoutSpy = vi.fn(() => 1);

  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    setTimeoutSpy.mockClear();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
    vi.stubGlobal("window", { clearTimeout: vi.fn(), setTimeout: setTimeoutSpy });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops queued session frames and close callbacks from a replaced machine socket", async () => {
    const socket = new SessionSocket();
    const oldHandler = vi.fn();
    const newHandler = vi.fn();
    const onInitialOpen = vi.fn();
    const target = { id: "session-1", cwd: "/repo" };
    socket.connect(target, oldHandler, undefined, "machine-a");
    const oldSocket = FakeWebSocket.instances[0];
    if (oldSocket === undefined) throw new Error("expected old session socket");
    const staleClose = oldSocket.onclose;
    oldSocket.onmessage?.({ data: JSON.stringify(inboxEvent()) });

    socket.connect(target, newHandler, undefined, "machine-b", onInitialOpen);
    staleClose?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(oldHandler).not.toHaveBeenCalled();
    expect(newHandler).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    const newSocket = FakeWebSocket.instances[1];
    if (newSocket === undefined) throw new Error("expected replacement session socket");
    newSocket.onopen?.();
    expect(onInitialOpen).toHaveBeenCalledOnce();
    newSocket.onmessage?.({ data: JSON.stringify(inboxEvent()) });
    await Promise.resolve();
    await Promise.resolve();
    expect(newHandler).toHaveBeenCalledOnce();
  });

  it("does not attribute a queued global frame to a replacement machine", async () => {
    const socket = new RealtimeSocket();
    const oldHandler = vi.fn();
    const newHandler = vi.fn();
    const event = { type: "machine.status", status: machineStatusWire() };
    socket.connect(oldHandler, undefined, "machine-a");
    const oldSocket = FakeWebSocket.instances[0];
    if (oldSocket === undefined) throw new Error("expected old realtime socket");
    oldSocket.onmessage?.({ data: JSON.stringify(event) });

    socket.connect(newHandler, undefined, "machine-b");
    await Promise.resolve();
    await Promise.resolve();

    expect(oldHandler).not.toHaveBeenCalled();
    expect(newHandler).not.toHaveBeenCalled();

    const newSocket = FakeWebSocket.instances[1];
    if (newSocket === undefined) throw new Error("expected replacement realtime socket");
    newSocket.onmessage?.({ data: JSON.stringify(event) });
    await Promise.resolve();
    await Promise.resolve();
    expect(newHandler).toHaveBeenCalledOnce();
  });
});

describe("jitteredReconnectDelay", () => {
  // A daemon restart drops every tab and device at once; an identical backoff
  // schedule then aims all of them at a process that is still starting.
  it("spreads a delay across the lower half of its window", () => {
    expect(jitteredReconnectDelay(1000, () => 0)).toBe(500);
    expect(jitteredReconnectDelay(1000, () => 0.5)).toBe(750);
    expect(jitteredReconnectDelay(1000, () => 0.999)).toBe(1000);
  });

  it("keeps the delay positive for the smallest window", () => {
    expect(jitteredReconnectDelay(500, () => 0)).toBe(250);
  });
});
