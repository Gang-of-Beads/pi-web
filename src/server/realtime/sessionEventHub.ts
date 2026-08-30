import type { GlobalSessionEvent, RealtimeEvent, SessionNotificationSummaryEvent, SessionUiEvent } from "../../shared/apiTypes.js";
import { projectBrowserSessionEvent } from "../browserMessageProjection.js";

export interface RealtimeSocket {
  readonly OPEN: number;
  readyState: number;
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
export const KEEPALIVE_INTERVAL_MS = 20_000;

export class SessionEventHub {
  private readonly socketsBySession = new Map<string, Set<RealtimeSocket>>();
  private readonly globalSockets = new Set<RealtimeSocket>();
  private readonly seqBySession = new Map<string, number>();
  /** Recent per-session frames, oldest first, for replaying a counted gap. */
  private readonly replayBySession = new Map<string, { seq: number; event: SessionUiEvent }[]>();
  private readonly replayBufferLimit: number;
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

  constructor(options?: { replayBufferLimit?: number }) {
    this.replayBufferLimit = options?.replayBufferLimit ?? 256;
  }

  /**
   * Start sending keepalives. Separate from the constructor so tests and
   * short-lived hubs are not left holding a timer, and unref'd so it never
   * keeps the process alive on its own.
   */
  startKeepalive(intervalMs = KEEPALIVE_INTERVAL_MS): void {
    if (this.keepaliveTimer !== undefined) return;
    const timer = setInterval(() => { this.sendKeepalive(); }, intervalMs);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    this.keepaliveTimer = timer;
  }

  stopKeepalive(): void {
    if (this.keepaliveTimer === undefined) return;
    clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = undefined;
  }

  /** One tick: a keepalive to every subscriber, session-scoped and global. */
  sendKeepalive(): void {
    const payload = JSON.stringify({ type: "keepalive" });
    for (const sockets of this.socketsBySession.values()) this.sendToSockets(sockets, payload);
    this.sendToSockets(this.globalSockets, payload);
  }

  add(sessionId: string, socket: RealtimeSocket): void {
    let sockets = this.socketsBySession.get(sessionId);
    if (!sockets) {
      sockets = new Set();
      this.socketsBySession.set(sessionId, sockets);
    }
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
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

  addGlobal(socket: RealtimeSocket): void {
    this.globalSockets.add(socket);
    socket.on("close", () => this.globalSockets.delete(socket));
    const joinFrame = this.globalJoinFrame?.();
    if (joinFrame !== undefined) this.sendToSocket(this.globalSockets, socket, JSON.stringify(joinFrame));
  }

  publish(sessionId: string, event: SessionUiEvent): void {
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
    const sockets = this.socketsBySession.get(sessionId);
    if (sockets === undefined || sockets.size === 0) return;
    const dropCount = this.dropNextPerSession.get(sessionId) ?? 0;
    if (dropCount > 0) {
      // Debug drop: delivery is skipped, the ring keeps the frame, and the
      // client's seq monitor sees the jump - the loss the repair exists for.
      const remaining = dropCount - 1;
      if (remaining === 0) this.dropNextPerSession.delete(sessionId);
      else this.dropNextPerSession.set(sessionId, remaining);
      return;
    }
    const payload = JSON.stringify({ ...projectBrowserSessionEvent(event), seq });
    this.sendToSockets(sockets, payload);
  }

  /**
   * Arm a debug drop of the next `count` per-session frames. Only callers the
   * daemon gates behind a debug flag may reach this; production code never
   * arms it.
   */
  debugDropNext(sessionId: string, count: number): void {
    this.dropNextPerSession.set(sessionId, Math.max(0, Math.floor(count)));
  }

  /**
   * The frames a client that last saw `sinceSeq` is missing, oldest first and
   * serialized exactly as the live path would have sent them. `resync` means
   * the ring no longer reaches - the client must fall back to a full read
   * rather than splice a hole into its transcript. No await anywhere near the
   * buffer read: the ring is captured in the same tick as the watermark.
   */
  replaySince(sessionId: string, sinceSeq: number): { verdict: "replay" | "resync"; frames: string[] } {
    const ring = this.replayBySession.get(sessionId);
    const seqs = ring?.map((entry) => entry.seq);
    const decision = replayDecision(seqs, sinceSeq);
    // Only replayable serves frames; caught-up is an honest empty replay;
    // every other state is unreplayable here and answered with resync.
    if (decision !== "replayable") return { verdict: decision === "caught-up" ? "replay" : "resync", frames: [] };
    const frames: string[] = [];
    for (const entry of ring ?? []) {
      if (entry.seq <= sinceSeq) continue;
      frames.push(JSON.stringify({ ...projectBrowserSessionEvent(entry.event), seq: entry.seq }));
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
    this.sendToSockets(this.globalSockets, payload);
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

  private sendToSocket(sockets: Set<RealtimeSocket>, socket: RealtimeSocket, payload: string): void {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(payload);
    } catch {
      sockets.delete(socket);
      try {
        socket.terminate();
      } catch {
        // Removal is authoritative; cleanup failure must not block healthy sockets.
      }
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
