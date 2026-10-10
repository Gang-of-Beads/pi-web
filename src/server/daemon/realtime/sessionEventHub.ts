import type { GlobalSessionEvent, RealtimeEvent, SessionNotificationSummaryEvent, SessionUiEvent, TranscriptHead } from "../../../shared/apiTypes.js";
import { randomUUID } from "node:crypto";
import { projectBrowserSessionEvent } from "../browserMessageProjection.js";
import { StatusDeltaScope } from "./statusDeltaScope.js";

export interface RealtimeSocket {
  readonly OPEN: number;
  readyState: number;
  readonly bufferedAmount: number;
  send(payload: string): void;
  terminate(): void;
  on(event: "close", listener: () => void): unknown;
}

/**
 * How often every subscriber is sent a keepalive frame.
 *
 * Nothing else guarantees traffic: a session can sit idle for minutes, and the
 * connection usually crosses a proxy (tailscale serve here) and at least one
 * NAT. When such a path drops a silent connection without sending FIN, the
 * browser's socket stays OPEN forever, onclose never fires, the reconnect that
 * would refetch state never runs, and the page shows stale data until someone
 * reloads it by hand. A frame every 20s keeps the path warm and, more
 * importantly, gives the client something to miss.
 */
export { KEEPALIVE_INTERVAL_MS } from "./keepaliveInterval.js";
import { KEEPALIVE_INTERVAL_MS } from "./keepaliveInterval.js";
/** How often the hub looks for sockets that have gone quiet long enough to need a heartbeat. */
const HEARTBEAT_TICK_MS = 1_000;
const HEARTBEAT_FLOOR_MS = 3_000;

/**
 * The heartbeat interval for a page whose quiet window is `quietMs`.
 *
 * Owner, 2026-09-30: a page pulls only after its quiet window T (default 15 s) passes with
 * nothing received, and heartbeats must stay small. A heartbeat at 0.6 T keeps a healthy idle
 * socket from ever reaching T, with room for one late frame. A page that names no window gets
 * the 20 s keepalive it always had; the floor keeps a tiny window from becoming a stream.
 */
export function heartbeatIntervalMs(quietMs?: number): number {
  if (quietMs === undefined || !Number.isFinite(quietMs)) return KEEPALIVE_INTERVAL_MS;
  return Math.min(KEEPALIVE_INTERVAL_MS, Math.max(HEARTBEAT_FLOOR_MS, Math.round(quietMs * 0.6)));
}

/** What a page asked of its socket: a quiet window to be heartbeated within, and status deltas. */
interface SocketOptions {
  readonly quietMs?: number;
  readonly statusDeltas?: boolean;
}

/** When a socket last carried anything, and how long it may stay quiet before a heartbeat. */
interface SocketCadence {
  intervalMs: number;
  lastSentAt: number;
}

/** A slower browser reconnects and repairs rather than buffering without bound. */
export const MAX_SOCKET_BUFFERED_BYTES = 1024 * 1024;
/** Inactive sessions beyond this LRU bound fall back to an authoritative resync. */
export const MAX_REPLAY_SESSIONS = 256;

export class SessionEventHub {
  private readonly socketsBySession = new Map<string, Set<RealtimeSocket>>();
  private readonly globalSockets = new Set<RealtimeSocket>();
  /** Whether a session socket gets a status's changes or the whole status (statusDeltaScope.ts). */
  private readonly sessionStatuses = new StatusDeltaScope();
  /** The same for the machine's sockets, whose statuses also carry the stream position. */
  private readonly globalStatuses = new StatusDeltaScope();
  private readonly seqBySession = new Map<string, number>();
  private readonly epochBySession = new Map<string, string>();
  private readonly instanceId = randomUUID().slice(0, 8);
  private epochCounter = 0;
  /** Recent per-session frames, oldest first, for replaying a counted gap. */
  private readonly replayBySession = new Map<string, { seq: number; event: SessionUiEvent }[]>();
  private readonly replayBufferLimit: number;
  private readonly replaySessionLimit: number;
  private readonly maxSocketBufferedBytes: number;
  /**
   * Debug-only frame-drop arm, for the e2e legs that need REAL loss. Gated
   * behind an explicit arming call that only the debug route makes (itself
   * gated by a daemon env flag); production runs with no armer at all. A
   * dropped frame is dropped from DELIVERY only - the ring keeps it, which is
   * exactly the repair path under test.
   */
  private dropNextPerSession = new Map<string, number>();
  private globalSeq = 0;
  private globalJoinFrame: (() => RealtimeEvent) | undefined;
  private keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  private readonly cadence = new WeakMap<RealtimeSocket, SocketCadence>();
  private readonly now: () => number;
  private transcriptHeadSource: ((sessionId: string) => TranscriptHead | undefined) | undefined;

  constructor(options?: { replayBufferLimit?: number; replaySessionLimit?: number; maxSocketBufferedBytes?: number; now?: () => number }) {
    this.replayBufferLimit = options?.replayBufferLimit ?? 256;
    this.replaySessionLimit = Math.max(1, options?.replaySessionLimit ?? MAX_REPLAY_SESSIONS);
    this.maxSocketBufferedBytes = Math.max(0, options?.maxSocketBufferedBytes ?? MAX_SOCKET_BUFFERED_BYTES);
    this.now = options?.now ?? Date.now;
  }

  /**
   * Where a session's transcript stands, for the heartbeat. The hub knows streams, not
   * transcripts, so the session service answers; undefined means it does not hold the session.
   */
  setTranscriptHeadSource(source: (sessionId: string) => TranscriptHead | undefined): void {
    this.transcriptHeadSource = source;
  }

  /**
   * Start the heartbeat. Separate from the constructor so tests and short-lived hubs are not
   * left holding a timer, and unref'd so it never keeps the process alive on its own. The timer
   * only looks; each socket is sent a heartbeat when it has itself been quiet for its interval.
   */
  startKeepalive(tickMs = HEARTBEAT_TICK_MS): void {
    if (this.keepaliveTimer !== undefined) return;
    const timer = setInterval(() => { this.heartbeatTick(); }, tickMs);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    this.keepaliveTimer = timer;
  }

  /** One look: a heartbeat to every socket that has been quiet for its own interval. */
  heartbeatTick(): void {
    const now = this.now();
    const due = (socket: RealtimeSocket) => {
      const cadence = this.cadence.get(socket);
      return cadence !== undefined && now - cadence.lastSentAt >= cadence.intervalMs;
    };
    for (const [sessionId, sockets] of this.socketsBySession) {
      const quiet = [...sockets].filter(due);
      if (quiet.length > 0) this.sendToEach(sockets, quiet, this.keepalivePayload(sessionId));
    }
    const quietGlobal = [...this.globalSockets].filter(due);
    if (quietGlobal.length > 0) this.sendToEach(this.globalSockets, quietGlobal, this.globalKeepalivePayload());
  }

  stopKeepalive(): void {
    if (this.keepaliveTimer === undefined) return;
    clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = undefined;
  }

  /** A keepalive to every subscriber at once, session-scoped and global. */
  sendKeepalive(): void {
    for (const [sessionId, sockets] of this.socketsBySession) this.sendToSockets(sockets, this.keepalivePayload(sessionId));
    this.sendToSockets(this.globalSockets, this.globalKeepalivePayload());
  }

  /**
   * The global scope's heartbeat carries its head: the last `seq` stamped on a global frame, so a
   * page that lost the last frame before a quiet stretch notices within one heartbeat (state-diagram
   * D5, "A lost announcement is noticed"). Nested under `head`, never a top-level `seq`, for the
   * reason the session heartbeat gives.
   */
  private globalKeepalivePayload(): string {
    return JSON.stringify({ type: "keepalive", head: { seq: this.globalSeq } });
  }

  /**
   * A session's heartbeat: the stream position and the transcript head, nested under `head`.
   *
   * Never a top-level `seq`: the page's gap repair reads that as a frame, and with exactly one
   * frame missing it would mark the heartbeat as the missed frame and lose the real one. The
   * epoch is read, not minted - a session that has published nothing has no stream to report.
   */
  private keepalivePayload(sessionId: string): string {
    const epoch = this.epochBySession.get(sessionId);
    const transcript = this.transcriptHeadSource?.(sessionId);
    const head = {
      ...(epoch === undefined ? {} : { seq: this.currentSeq(sessionId), epoch }),
      ...(transcript ?? {}),
    };
    return JSON.stringify(Object.keys(head).length === 0 ? { type: "keepalive" } : { type: "keepalive", head });
  }

  add(sessionId: string, socket: RealtimeSocket, options: SocketOptions = {}): void {
    let sockets = this.socketsBySession.get(sessionId);
    if (!sockets) {
      sockets = new Set();
      this.socketsBySession.set(sessionId, sockets);
    }
    sockets.add(socket);
    this.cadence.set(socket, { intervalMs: heartbeatIntervalMs(options.quietMs), lastSentAt: this.now() });
    if (options.statusDeltas === true) this.sessionStatuses.ask(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      if (sockets.size === 0 && this.socketsBySession.get(sessionId) === sockets) this.socketsBySession.delete(sessionId);
    });
  }

  /**
   * Frame sent to each global subscriber the moment it joins, before any live
   * event. It closes the join race for state the browser would otherwise only
   * fetch over HTTP: with two proxy hops in federation, that fetch can resolve
   * before the upstream subscription exists and then be clobbered by a stale
   * value.
   */
  setGlobalJoinFrame(frame: () => RealtimeEvent): void {
    this.globalJoinFrame = frame;
  }

  /**
   * A machine-wide subscriber, heartbeated within the quiet window it named, as a session's is.
   * The join frame echoes that window (`quiet`, seconds): the page checks the socket after a
   * window of silence only when its daemon confirmed it, so a daemon or a remote machine that
   * predates it, which keeps the 20 s heartbeat, is never taken for silent (B28). A page that
   * asked for status deltas gets a status's changes once it has had the whole status.
   */
  addGlobal(socket: RealtimeSocket, options: SocketOptions = {}): void {
    this.globalSockets.add(socket);
    this.cadence.set(socket, { intervalMs: heartbeatIntervalMs(options.quietMs), lastSentAt: this.now() });
    if (options.statusDeltas === true) this.globalStatuses.ask(socket);
    socket.on("close", () => this.globalSockets.delete(socket));
    const joinFrame = this.globalJoinFrame?.();
    const quiet = options.quietMs === undefined ? {} : { quiet: options.quietMs / 1000 };
    if (joinFrame !== undefined) this.sendToSocket(this.globalSockets, socket, JSON.stringify({ ...joinFrame, seq: this.globalSeq, ...quiet }));
  }

  publish(sessionId: string, event: SessionUiEvent): void {
    const epoch = this.currentEpoch(sessionId);
    const seq = (this.seqBySession.get(sessionId) ?? 0) + 1;
    this.seqBySession.set(sessionId, seq);
    // The ring records every stamped frame, listeners or not: a frame published
    // while nobody watched is exactly the frame a later gap needs replayed.
    let ring = this.replayBySession.get(sessionId);
    if (ring === undefined) {
      ring = [];
      this.replayBySession.set(sessionId, ring);
    }
    ring.push({ seq, event });
    while (ring.length > this.replayBufferLimit) ring.shift();
    this.touchReplaySession(sessionId, ring);
    this.evictInactiveReplaySessions(sessionId);
    const sockets = this.socketsBySession.get(sessionId);
    if (sockets === undefined || sockets.size === 0) return;
    const dropCount = this.dropNextPerSession.get(sessionId) ?? 0;
    if (dropCount > 0) {
      // Debug drop: delivery is skipped, the ring keeps the frame, and the
      // client's seq monitor sees the jump - the loss the repair exists for.
      const remaining = dropCount - 1;
      if (remaining === 0) this.dropNextPerSession.delete(sessionId);
      else this.dropNextPerSession.set(sessionId, remaining);
      this.sessionStatuses.outOfStep(sockets, sessionId);
      return;
    }
    const payload = JSON.stringify({ ...projectBrowserSessionEvent(event), seq, epoch });
    if (event.type === "status.update") this.sendEach(sockets, this.sessionStatuses.payloads(sessionId, { ...event.status }, payload, { seq, epoch }));
    else this.sendToSockets(sockets, payload);
  }

  /**
   * The epoch of a session's seq space: which run of numbers its seqs belong to.
   *
   * The seq space restarts when a daemon restarts or when the ring of an inactive session is
   * evicted, and a bare number cannot say which space it came from - so an old watermark was
   * answered as caught up, or replayed with every frame it had never seen missing. A watermark
   * is a seq and its epoch; one with any other epoch, or none, is answered with resync. The
   * epoch is minted when the space starts - at the first publish or snapshot, and after an
   * eviction - from this instance's id, so no two runs of numbers share one.
   */
  currentEpoch(sessionId: string): string {
    let epoch = this.epochBySession.get(sessionId);
    if (epoch === undefined) {
      this.epochCounter += 1;
      epoch = `${this.instanceId}.${String(this.epochCounter)}`;
      this.epochBySession.set(sessionId, epoch);
    }
    return epoch;
  }

  /**
   * Arm a debug drop of the next `count` per-session frames. Only callers the
   * daemon gates behind a debug flag may reach this; production code never
   * arms it.
   */
  debugDropNext(sessionId: string, count: number): void {
    // count 0 disarms: the drop map entry is removed, not zeroed, so the
    // publish path's per-session lookup misses cleanly.
    if (Math.floor(count) <= 0) {
      this.dropNextPerSession.delete(sessionId);
      return;
    }
    this.dropNextPerSession.set(sessionId, Math.floor(count));
  }

  /**
   * The frames a client that last saw `sinceSeq` is missing, oldest first and
   * serialized exactly as the live path would have sent them. `resync` means
   * the ring no longer reaches - the client must fall back to a full read
   * rather than splice a hole into its transcript. No await anywhere near the
   * buffer read: the ring is captured in the same tick as the watermark.
   */
  replaySince(sessionId: string, sinceSeq: number, epoch?: string): { verdict: "replay" | "resync"; frames: string[] } {
    const current = this.epochBySession.get(sessionId);
    if (epoch !== current) return { verdict: "resync", frames: [] };
    const ring = this.replayBySession.get(sessionId);
    const seqs = ring?.map((entry) => entry.seq);
    const decision = replayDecision(seqs, sinceSeq);
    // Only replayable serves frames; caught-up is an honest empty replay;
    // every other state is unreplayable here and answered with resync.
    if (decision !== "replayable") return { verdict: decision === "caught-up" ? "replay" : "resync", frames: [] };
    const frames: string[] = [];
    for (const entry of ring ?? []) {
      if (entry.seq <= sinceSeq) continue;
      frames.push(JSON.stringify({ ...projectBrowserSessionEvent(entry.event), seq: entry.seq, epoch: current }));
    }
    return { verdict: "replay", frames };
  }

  /**
   * Last per-session sequence number stamped by {@link publish} (0 before any
   * event). Callers building a join-time stream snapshot read this as the
   * watermark: buffered live events with `seq <= currentSeq` are already
   * reflected in the snapshot's partial and must be dropped by the client.
   */
  currentSeq(sessionId: string): number {
    return this.seqBySession.get(sessionId) ?? 0;
  }

  /**
   * Last global-scope sequence number stamped by {@link publishRealtime} and
   * {@link publishNotificationSummary} (0 before any event). One counter for
   * the one global scope: notification summaries and realtime events share it,
   * so a gap in one surface is a gap in the stream the client can count.
   */
  currentGlobalSeq(): number {
    return this.globalSeq;
  }

  publishGlobal(event: GlobalSessionEvent): void {
    this.publishRealtime(event);
  }

  publishNotificationSummary(event: SessionNotificationSummaryEvent): void {
    const seq = this.nextGlobalSeq();
    const payload = JSON.stringify({ ...event, seq });
    this.sendToSockets(this.globalSockets, payload);
  }

  publishRealtime(event: RealtimeEvent): void {
    const seq = this.nextGlobalSeq();
    // Keep seq monotonic (dark-launch gap counting) but skip serialization when
    // no browser is subscribed: same zero-listener discipline as publish.
    if (this.globalSockets.size === 0) return;
    const payload = JSON.stringify({ ...event, seq });
    if (event.type === "status.update") this.sendEach(this.globalSockets, this.globalStatuses.payloads(event.status.sessionId, { ...event.status }, payload, { seq }));
    else this.sendToSockets(this.globalSockets, payload);
  }

  /**
   * Advance and return the global-scope sequence. Advanced on every publish
   * regardless of subscribers: a frame published while nobody listened must
   * still cost a number, or the next delivered frame would look consecutive to
   * a client that missed nothing when in fact a frame died unobserved.
   */
  private nextGlobalSeq(): number {
    this.globalSeq += 1;
    return this.globalSeq;
  }

  private sendToSockets(sockets: Set<RealtimeSocket> | undefined, payload: string): void {
    if (sockets === undefined) return;
    for (const socket of sockets) this.sendToSocket(sockets, socket, payload);
  }

  private sendEach(sockets: Set<RealtimeSocket>, payloadFor: (socket: RealtimeSocket) => string): void {
    for (const socket of sockets) this.sendToSocket(sockets, socket, payloadFor(socket));
  }

  private sendToEach(sockets: Set<RealtimeSocket>, targets: readonly RealtimeSocket[], payload: string): void {
    for (const socket of targets) this.sendToSocket(sockets, socket, payload);
  }

  private sendToSocket(sockets: Set<RealtimeSocket>, socket: RealtimeSocket, payload: string): void {
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > this.maxSocketBufferedBytes) {
      this.removeAndTerminate(sockets, socket);
      return;
    }
    try {
      socket.send(payload);
      const cadence = this.cadence.get(socket);
      if (cadence !== undefined) cadence.lastSentAt = this.now();
    } catch {
      this.removeAndTerminate(sockets, socket);
    }
  }

  private removeAndTerminate(sockets: Set<RealtimeSocket>, socket: RealtimeSocket): void {
    sockets.delete(socket);
    try {
      socket.terminate();
    } catch {
      // Removal is authoritative; cleanup failure must not block healthy sockets.
    }
  }

  /** Move a used ring to the end of the Map, which is its LRU order. */
  private touchReplaySession(sessionId: string, ring: { seq: number; event: SessionUiEvent }[]): void {
    this.replayBySession.delete(sessionId);
    this.replayBySession.set(sessionId, ring);
  }

  private evictInactiveReplaySessions(currentSessionId: string): void {
    while (this.replayBySession.size > this.replaySessionLimit) {
      let evicted = false;
      for (const sessionId of this.replayBySession.keys()) {
        if (sessionId === currentSessionId || (this.socketsBySession.get(sessionId)?.size ?? 0) > 0) continue;
        this.replayBySession.delete(sessionId);
        this.seqBySession.delete(sessionId);
        this.epochBySession.delete(sessionId);
        this.dropNextPerSession.delete(sessionId);
        evicted = true;
        break;
      }
      if (!evicted && (this.socketsBySession.get(currentSessionId)?.size ?? 0) === 0) {
        this.replayBySession.delete(currentSessionId);
        this.seqBySession.delete(currentSessionId);
        this.epochBySession.delete(currentSessionId);
        this.dropNextPerSession.delete(currentSessionId);
        evicted = true;
      }
      // Every retained ring has a live subscriber; socket count now bounds it.
      if (!evicted) return;
    }
  }
}

/**
 * Where a client that last saw `sinceSeq` stands relative to the ring, as a
 * state, not a ladder of guards. The states a replay request can be in:
 *
 * - `unknown-session` - no ring exists here: a fresh client misses nothing;
 *   any claimed progress is unverifiable (restart reset the space).
 * - `ahead` - the client cites a stamp beyond this instance's last: a stale
 *   claim from another instance; unreplayable.
 * - `caught-up` - the client holds the last stamp: nothing to send.
 * - `out-of-reach` - the ring has evicted past `sinceSeq`: a hole would
 *   remain; resync is the honest answer.
 * - `replayable` - the ring covers `(sinceSeq, last]` exactly.
 */
type ReplayState = "unknown-session" | "ahead" | "caught-up" | "out-of-reach" | "replayable";

export function replayDecision(ringSeqs: readonly number[] | undefined, sinceSeq: number): ReplayState {
  if (ringSeqs === undefined || ringSeqs.length === 0) return sinceSeq > 0 ? "unknown-session" : "caught-up";
  const oldest = ringSeqs[0] ?? Number.NaN;
  const last = ringSeqs[ringSeqs.length - 1] ?? Number.NaN;
  if (sinceSeq > last) return "unknown-session";
  if (sinceSeq === last) return "caught-up";
  if (oldest > sinceSeq + 1) return "out-of-reach";
  return "replayable";
}
