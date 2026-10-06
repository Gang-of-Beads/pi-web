import { realtimeEvents, sessionEvents } from "./api";
import { ackWatch } from "./api/ackWatch";
import { parseRealtimeStreamEvent, parseSessionAskClosedEvent, parseSessionAskOpenedEvent, parseSessionDialogClosedEvent, parseSessionDialogOpenedEvent, parseSessionNotificationInboxEvent, parseSessionStartupProgressEvent, parseSessionStreamEvent, parseSessionUnreadEvent } from "./api/parsers";
import type { RealtimeEvent, SessionRef, SessionUiEvent } from "../../shared/apiTypes";
import { socketLivenessVerdict, type SocketReadyState } from "./socketLiveness";
import type { SocketPhase } from "./socketAnchoredRead";
import type { Unanswered } from "./sync/scopedResource";
import type { SessionSocketHandlers } from "./controllers/sessionController";

export type { GlobalSessionEvent, RealtimeEvent, SessionUiEvent } from "../../shared/apiTypes";

export type BrowserRealtimeEvent = Exclude<RealtimeEvent, { type: "notifications.summary" }>;

/**
 * A connection is considered dead when it has been silent for longer than this.
 *
 * The daemon sends a keepalive every 20s, so silence past two of them is not
 * quiet traffic - it is a socket that will never deliver anything again. The
 * browser cannot see that on its own: a proxy or NAT that drops a connection
 * without a FIN leaves readyState at OPEN forever, so onclose never fires and
 * the reconnect that would refetch state never runs. That is the failure people
 * describe as "the page only updates if I refresh it".
 */
/**
 * Silence budget: two keepalives (20s each on the daemon) plus a margin. It
 * used to be 50s, which meant a socket the network killed without a FIN kept
 * looking alive for the better part of a minute after the network came back.
 */
export const LIVENESS_TIMEOUT_MS = 42_000;
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * Reconnect delay with jitter.
 *
 * Every tab and device reconnects the moment a daemon restart drops them all,
 * and an identical backoff schedule turns that into a synchronised stampede
 * against a process that is still starting. Spreading each attempt across its
 * own delay window is the standard remedy; the shape of the backoff is
 * unchanged, only its edges are blurred.
 */
export function jitteredReconnectDelay(delay: number, random: () => number = Math.random): number {
  return Math.round(delay * (0.5 + random() * 0.5));
}

export class SessionSocket {
  private socket: WebSocket | undefined;
  private session: SessionRef | undefined;
  private onEvent: ((event: SessionUiEvent) => void) | undefined;
  private seqMonitor = new ScopeSeqMonitor("session");
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectDelay = 500;
  private shouldReconnect = false;
  private hasOpened = false;
  private onReconnect: (() => void) | undefined;
  private onInitialOpen: (() => void) | undefined;
  private onMalformed: ((frameType: string) => void) | undefined;
  private onDisconnect: (() => void) | undefined;
  /** The connection that opened, so losing it is told apart from an attempt that never connected. */
  private openedSocket: WebSocket | undefined;
  private machineId = "local";
  private lastFrameAt = 0;
  private connectStartedAt = 0;

  /**
   * Drop a connection that has gone silent past the keepalive budget, so the
   * normal reconnect path (and the refresh it triggers) can run. Called when
   * the browser comes back to the foreground, which is exactly when a
   * connection that died while the tab was hidden needs to be noticed.
   */
  checkLiveness(now = Date.now()): void {
    const socket = this.socket;
    if (socket === undefined) return;
    const verdict = socketLivenessVerdict({
      readyState: readyStateOf(socket),
      wantsConnection: this.shouldReconnect,
      lastFrameAt: this.lastFrameAt,
      connectStartedAt: this.connectStartedAt,
      now,
      silenceBudgetMs: LIVENESS_TIMEOUT_MS,
      handshakeBudgetMs: HANDSHAKE_TIMEOUT_MS,
    });
    if (verdict !== "drop-and-reconnect") return;
    // closeSocketQuietly detaches onclose before closing, so the close that
    // normally schedules the reconnect cannot: dropping a dead socket without
    // this left nothing connected and nothing trying, which is a worse stall
    // than the one being repaired. The reconnect is what refetches whatever
    // was missed, so it is scheduled here rather than hoped for.
    this.socket = undefined;
    closeSocketQuietly(socket);
    this.scheduleReconnect();
    this.lost(socket);
  }

  /**
   * Where the page stands on this session's stream after a read or a replay that did not come
   * over the socket: a heartbeat head ahead of it is a loss with nothing after it to show it.
   */
  noteApplied(seq: number): void {
    this.seqMonitor.noteApplied(seq);
  }

  /** An open connection went away; a failed attempt is not news, or a down daemon would repeat it. */
  private lost(socket: WebSocket): void {
    if (this.openedSocket !== socket) return;
    this.openedSocket = undefined;
    this.onDisconnect?.();
  }

  /** Gap events counted on this socket's per-session scope since connect(). */
  get gapCount(): number {
    return this.seqMonitor.gapCount;
  }

  connect(session: SessionRef, machineId: string, handlers: SessionSocketHandlers): void {
    this.close();
    this.machineId = machineId;
    this.session = session;
    this.onEvent = handlers.onEvent;
    this.onReconnect = handlers.onReconnect;
    this.onInitialOpen = handlers.onInitialOpen;
    this.onMalformed = handlers.onMalformed;
    this.onDisconnect = handlers.onDisconnect;
    this.seqMonitor = new ScopeSeqMonitor("session", handlers.onGap);
    this.shouldReconnect = true;
    this.open();
  }

  setHandler(onEvent: (event: SessionUiEvent) => void): void {
    this.onEvent = onEvent;
  }

  close(): void {
    this.shouldReconnect = false;
    globalThis.clearTimeout(this.reconnectTimer);
    closeSocketQuietly(this.socket);
    this.socket = undefined;
    this.session = undefined;
    this.onEvent = undefined;
    this.onReconnect = undefined;
    this.onInitialOpen = undefined;
    this.onMalformed = undefined;
    this.onDisconnect = undefined;
    this.openedSocket = undefined;
    this.hasOpened = false;
    this.machineId = "local";
  }

  private open(): void {
    const session = this.session;
    if (session === undefined || session.id === "" || session.cwd === "" || !this.shouldReconnect) return;
    const socket = sessionEvents(session, this.machineId);
    this.socket = socket;
    this.connectStartedAt = Date.now();
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.lastFrameAt = Date.now();
      ackWatch.heard();
      // Reconnect refetches everything, and a daemon restart resets the hub's
      // counter, so the first frame after an open says nothing about loss.
      this.seqMonitor.reset();
      this.openedSocket = socket;
      const isReconnect = this.hasOpened;
      this.hasOpened = true;
      if (isReconnect) this.onReconnect?.();
      else this.onInitialOpen?.();
    };
    socket.onmessage = (message) => void this.handleMessage(message.data, socket, session);
    socket.onerror = () => { socket.close(); };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.scheduleReconnect();
      this.lost(socket);
    };
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    globalThis.clearTimeout(this.reconnectTimer);
    const delay = jitteredReconnectDelay(this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 5000);
    this.reconnectTimer = globalThis.setTimeout(() => { this.open(); }, delay);
  }

  /**
   * The network is back: retry now instead of sitting out the rest of a
   * backoff window that was measured against a network that no longer exists.
   */
  reconnectNow(): void {
    if (!this.shouldReconnect || this.socket !== undefined) return;
    globalThis.clearTimeout(this.reconnectTimer);
    this.reconnectDelay = 500;
    this.open();
  }

  private async handleMessage(data: MessageEvent["data"], socket: WebSocket, session: SessionRef): Promise<void> {
    // Any frame is proof of life, including the keepalive, which parses to
    // nothing and is dropped below. It is also the first proof the session's
    // machine answered: the web proxy accepts the upgrade before it reaches
    // the daemon, so the backoff resets here and not at the open, or a daemon
    // that is down is retried every half second for as long as it stays down.
    if (this.socket === socket) {
      this.lastFrameAt = Date.now();
      this.reconnectDelay = 500;
      ackWatch.heard();
    }
    const raw = await parseSocketEvent(data);
    this.seqMonitor.observe(raw);
    const head = heartbeatHeadSeq(raw);
    if (head !== undefined) this.seqMonitor.observeHead(head);
    const event = parseSessionSocketEvent(raw);
    if (this.socket !== socket) return;
    if (event === undefined) {
      // Validation failure on a revisioned surface is a gap: report it so the
      // surface resyncs instead of silently missing one transition.
      const malformedType = revisionedFrameType(raw);
      if (malformedType !== undefined) this.onMalformed?.(malformedType);
      return;
    }
    if (event.type === "notifications.inbox" && (session.id !== event.summary.sessionId || session.cwd !== event.summary.cwd)) return;
    this.onEvent?.(event);
  }
}

export class RealtimeSocket {
  private socket: WebSocket | undefined;
  private onEvent: ((event: BrowserRealtimeEvent) => void) | undefined;
  private readonly seqMonitor = new ScopeSeqMonitor("global", () => { this.onMissed?.(); });
  private onOpen: (() => void) | undefined;
  private onMissed: (() => void) | undefined;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectDelay = 500;
  private shouldReconnect = false;
  private machineId = "local";
  private lastFrameAt = 0;
  private connectStartedAt = 0;
  private openedSocket: WebSocket | undefined;
  private waitingSince = 0;
  private reachedServer = false;
  private phaseListener: (() => void) | undefined;

  /**
   * Where this socket stands for `machineId` (state-diagram D5, P6 slice a): absent when it is not
   * wanted or serves another machine, open once its current connection opened, and otherwise
   * connecting since it was asked to connect or its last open connection went away. A fact this
   * socket keeps live is read at the open, so a need that arises while it connects can wait.
   */
  phaseFor(machineId: string): SocketPhase {
    if (!this.shouldReconnect || this.machineId !== machineId) return { kind: "absent" };
    if (this.socket !== undefined && this.openedSocket === this.socket) return { kind: "open" };
    return { kind: "connecting", since: this.waitingSince };
  }

  /**
   * Since when `machineId` has gone without speaking on this socket, and why, for the app row
   * (B48): the link itself is down while no attempt reaches the server, and the machine is not
   * answering while attempts reach the server but nothing comes back through it.
   */
  unanswered(machineId: string): Unanswered | undefined {
    const phase = this.phaseFor(machineId);
    if (phase.kind !== "connecting") return undefined;
    return { since: phase.since, miss: this.reachedServer ? { kind: "machine-unanswering", machineId } : { kind: "link-down" } };
  }

  /** Told whenever phaseFor or unanswered may answer differently. */
  watchPhase(listener: (() => void) | undefined): void {
    this.phaseListener = listener;
  }

  /** Same liveness contract as SessionSocket; see checkLiveness there. */
  checkLiveness(now = Date.now()): void {
    const socket = this.socket;
    if (socket === undefined) return;
    const verdict = socketLivenessVerdict({
      readyState: readyStateOf(socket),
      wantsConnection: this.shouldReconnect,
      lastFrameAt: this.lastFrameAt,
      connectStartedAt: this.connectStartedAt,
      now,
      silenceBudgetMs: LIVENESS_TIMEOUT_MS,
      handshakeBudgetMs: HANDSHAKE_TIMEOUT_MS,
    });
    if (verdict !== "drop-and-reconnect") return;
    // Same as SessionSocket: the quiet close detaches onclose, so this must
    // schedule the reconnect itself or the drop is permanent.
    this.socket = undefined;
    if (this.openedSocket === socket) this.waitingSince = now;
    closeSocketQuietly(socket);
    this.scheduleReconnect();
    this.phaseListener?.();
  }

  /** Gap events counted on the global scope since this socket last opened. */
  get gapCount(): number {
    return this.seqMonitor.gapCount;
  }

  /**
   * `onMissed`: the machine announced something this socket never delivered - a frame whose `seq`
   * skips, or a heartbeat whose head is ahead of the last frame (state-diagram D5, "A lost
   * announcement is noticed"). Whatever the socket keeps live is to be read again.
   */
  connect(onEvent: (event: BrowserRealtimeEvent) => void, onOpen?: () => void, machineId = "local", onMissed?: () => void): void {
    this.close();
    this.machineId = machineId;
    this.onEvent = onEvent;
    this.onOpen = onOpen;
    this.onMissed = onMissed;
    this.shouldReconnect = true;
    this.waitingSince = Date.now();
    this.reachedServer = false;
    this.open();
  }

  close(): void {
    this.shouldReconnect = false;
    globalThis.clearTimeout(this.reconnectTimer);
    closeSocketQuietly(this.socket);
    this.socket = undefined;
    this.onEvent = undefined;
    this.onOpen = undefined;
    this.onMissed = undefined;
    this.machineId = "local";
  }

  private open(): void {
    if (!this.shouldReconnect) return;
    const socket = realtimeEvents(this.machineId);
    this.socket = socket;
    this.connectStartedAt = Date.now();
    let reached = false;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      reached = true;
      this.reachedServer = true;
      this.lastFrameAt = Date.now();
      ackWatch.heard();
    };
    socket.onmessage = (message) => void this.handleMessage(message.data, socket);
    socket.onerror = () => { socket.close(); };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.reachedServer = reached;
      if (this.openedSocket === socket) this.waitingSince = Date.now();
      this.scheduleReconnect();
      this.phaseListener?.();
    };
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    globalThis.clearTimeout(this.reconnectTimer);
    const delay = jitteredReconnectDelay(this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 5000);
    this.reconnectTimer = globalThis.setTimeout(() => { this.open(); }, delay);
  }

  /**
   * The network is back: retry now instead of sitting out the rest of a
   * backoff window that was measured against a network that no longer exists.
   */
  reconnectNow(): void {
    if (!this.shouldReconnect || this.socket !== undefined) return;
    globalThis.clearTimeout(this.reconnectTimer);
    this.reconnectDelay = 500;
    this.open();
  }

  private async handleMessage(data: MessageEvent["data"], socket: WebSocket): Promise<void> {
    if (this.socket === socket) {
      this.lastFrameAt = Date.now();
      ackWatch.heard();
    }
    const raw = await parseSocketEvent(data);
    // Observed on the raw frame, before validation: a notifications.summary is
    // dropped from the typed event stream, but its stamp still costs a number
    // in the global sequence and must advance the client's last-seen with it.
    if (this.socket !== socket) return;
    if (this.openedSocket !== socket) this.prove(socket);
    this.seqMonitor.observe(raw);
    const head = heartbeatHeadSeq(raw);
    if (head !== undefined) this.seqMonitor.observeHead(head);
    const event = parseRealtimeSocketEvent(raw);
    if (event !== undefined) this.onEvent?.(event);
  }

  /**
   * The machine spoke, so the connection is open. The transport's own open is not that proof:
   * the web proxy accepts the upgrade first and bridges to the daemon second, so a daemon that is
   * down still opens the socket and closes it a moment later. Opening there reset the backoff and
   * re-read the machine's facts on every flap - 931 rounds of four failing reads in eight minutes
   * on 8505 (2026-10-04), each one a line in the error log. The daemon sends its machine status
   * the moment a global subscriber joins, so a live machine proves itself at once.
   */
  private prove(socket: WebSocket): void {
    this.openedSocket = socket;
    this.reconnectDelay = 500;
    this.seqMonitor.reset();
    this.onOpen?.();
    this.phaseListener?.();
  }
}

/**
 * The surfaces whose frames carry a monotonic revision. A frame of one of
 * these types that fails validation is a lost transition, not noise: the
 * surface's revision never advances, so the next valid frame applies on top
 * of a state missing one step - the stuck-card failure through another door.
 * The caller treats it as a gap and requests the surface's resync.
 */
const REVISIONED_FRAME_TYPES = new Set(["notifications.inbox", "ask.opened", "ask.closed", "dialog.opened", "dialog.closed"]);

/** The revisioned surface behind a raw frame, or undefined for everything else. */
export function revisionedFrameType(event: unknown): string | undefined {
  const type = eventType(event);
  return REVISIONED_FRAME_TYPES.has(type) ? type : undefined;
}

export function parseSessionSocketEvent(event: unknown): SessionUiEvent | undefined {
  const type = eventType(event);
  const validate = DEDICATED_VALIDATORS.get(type) ?? parseSessionStreamEvent;
  const parsed = safelyParseValidatedEvent(() => validate(event));
  return parsed === undefined ? undefined : withTransportSeq(parsed, event);
}

export function parseRealtimeSocketEvent(event: unknown): BrowserRealtimeEvent | undefined {
  const type = eventType(event);
  if (type === "sessions.unread") return safelyParseValidatedEvent(() => parseSessionUnreadEvent(event));
  if (type === "session.startup") return safelyParseValidatedEvent(() => parseSessionStartupProgressEvent(event));
  return safelyParseValidatedEvent(() => parseRealtimeStreamEvent(event));
}

/**
 * Inbox, ask and dialog frames have dedicated validators: they drive the notification inbox and
 * the interactive cards answered on the model's or an extension's behalf. Every other accepted
 * frame is session stream vocabulary, validated field by field. Every one of them keeps its
 * transport seq: the gap repair counts the frames the socket delivered, and a dialog frame whose
 * seq was dropped in validation made the next frame look like a gap (P3 slice c).
 */
const DEDICATED_VALIDATORS = new Map<string, (event: unknown) => SessionUiEvent>([
  ["notifications.inbox", parseSessionNotificationInboxEvent],
  ["ask.opened", parseSessionAskOpenedEvent],
  ["ask.closed", parseSessionAskClosedEvent],
  ["dialog.opened", parseSessionDialogOpenedEvent],
  ["dialog.closed", parseSessionDialogClosedEvent],
]);

// The hub stamps every per-session frame with a monotonic seq that the
// join-time exactly-once filter compares against the stream snapshot watermark.
// Validation rebuilds the event object, so the stamp must be carried over
// explicitly; a frame without a numeric stamp still flows, because the
// watermark filter fails open for unstamped events.
function withTransportSeq(event: SessionUiEvent, raw: unknown): SessionUiEvent {
  if (typeof raw !== "object" || raw === null || !("seq" in raw)) return event;
  const seq = raw.seq;
  if (typeof seq !== "number") return event;
  const epoch: unknown = "epoch" in raw ? raw.epoch : undefined;
  return typeof epoch === "string" ? { ...event, seq, epoch } : { ...event, seq };
}

/**
 * Dark-launch loss accounting for one sequenced scope: the transcript scope of
 * one session, or the one global scope. The hub stamps every frame with a
 * monotonic seq and nothing compared it after join, so a frame lost to a
 * dead-but-OPEN socket or to a validation throw silently left the surface it
 * carried stale - stuck cards, a count disagreeing with its drawer.
 *
 * Gaps are counted and logged, nothing more: acting on them is the next
 * change. A frame without a numeric stamp fails open exactly as
 * {@link withTransportSeq} does - an unupgraded peer degrades to today's
 * behaviour instead of counting phantom gaps.
 */
export class ScopeSeqMonitor {
  private lastSeen: number | undefined;
  private gapEvents = 0;

  constructor(private readonly scope: string, private readonly onGap?: (lastSeen: number) => void) {}

  /** Gap events recorded on this scope since the last {@link reset}. */
  get gapCount(): number {
    return this.gapEvents;
  }

  /** Forget the baseline: called on every (re)open, since a reconnect
   *  refetches the surface and a daemon restart restarts the counter. */
  reset(): void {
    this.lastSeen = undefined;
  }

  /**
   * The position the page reached without this socket (a read's snapshot, a replay). Without it the
   * first heartbeat after a join became the baseline, and frames published between the read and
   * the subscription were never asked for on a session that then went quiet.
   */
  noteApplied(seq: number): void {
    if (this.lastSeen === undefined || seq > this.lastSeen) this.lastSeen = seq;
  }

  /**
   * A heartbeat's head: the last `seq` the scope stamped. A head ahead of the last frame seen means
   * the frames after it were lost with nothing after them to show it. The head becomes the last seen,
   * so one loss is reported once. Before any frame, the head is the baseline.
   */
  observeHead(seq: number): void {
    const last = this.lastSeen;
    if (last !== undefined && seq <= last) return;
    this.lastSeen = seq;
    if (last === undefined) return;
    this.gapEvents += 1;
    this.onGap?.(last);
  }

  observe(raw: unknown): void {
    if (typeof raw !== "object" || raw === null || !("seq" in raw)) return;
    const seq = raw.seq;
    if (typeof seq !== "number" || !Number.isFinite(seq)) return;
    const last = this.lastSeen;
    // A duplicate or late frame is evidence that nothing was lost - the
    // watermark filter drops it downstream. It must not count as loss, and it
    // must not rewind the baseline or the next frame would look like a gap.
    if (last !== undefined && seq <= last) return;
    this.lastSeen = seq;
    if (last === undefined || seq === last + 1) return;
    this.gapEvents += 1;
    // Fired before the revealing frame is delivered, so a repair can hold
    // the live tail instead of applying it ahead of the missing frames.
    this.onGap?.(last);
    console.warn(`[pi-web] ${this.scope} scope lost frames: expected ${String(last + 1)}, got ${String(seq)} (${String(seq - last - 1)} missing)`);
  }
}

/** The `seq` a heartbeat carries under `head`, or undefined for any other frame and an older daemon's bare heartbeat. */
function heartbeatHeadSeq(raw: unknown): number | undefined {
  if (eventType(raw) !== "keepalive" || typeof raw !== "object" || raw === null) return undefined;
  const head: unknown = Reflect.get(raw, "head");
  const seq: unknown = typeof head === "object" && head !== null ? Reflect.get(head, "seq") : undefined;
  return typeof seq === "number" && Number.isFinite(seq) ? seq : undefined;
}

function safelyParseValidatedEvent<T>(parse: () => T): T | undefined {
  try {
    return parse();
  } catch {
    return undefined;
  }
}

function eventType(event: unknown): string {
  if (typeof event !== "object" || event === null || !("type" in event)) return "";
  const type = event.type;
  return typeof type === "string" ? type : "";
}

async function parseSocketEvent(data: MessageEvent["data"]): Promise<unknown> {
  try {
    if (typeof data === "string") return JSON.parse(data);
    if (data instanceof Blob) return JSON.parse(await data.text());
    if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data));
    return undefined;
  } catch {
    return undefined;
  }
}

function closeSocketQuietly(socket: WebSocket | undefined): void {
  if (socket === undefined) return;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.onopen = () => { socket.close(); };
    return;
  }
  socket.close();
}

function readyStateOf(socket: WebSocket): SocketReadyState {
  if (socket.readyState === WebSocket.CONNECTING) return "connecting";
  if (socket.readyState === WebSocket.OPEN) return "open";
  if (socket.readyState === WebSocket.CLOSING) return "closing";
  return "closed";
}
