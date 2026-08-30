import { realtimeEvents, sessionEvents } from "./api";
import { parseRealtimeStreamEvent, parseSessionAskClosedEvent, parseSessionAskOpenedEvent, parseSessionDialogClosedEvent, parseSessionDialogOpenedEvent, parseSessionNotificationInboxEvent, parseSessionStartupProgressEvent, parseSessionStreamEvent, parseSessionUnreadEvent } from "./api/parsers";
import type { RealtimeEvent, SessionRef, SessionUiEvent } from "../../shared/apiTypes";

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
const LIVENESS_TIMEOUT_MS = 50_000;

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
  private readonly seqMonitor = new ScopeSeqMonitor("session");
  private reconnectTimer?: number;
  private reconnectDelay = 500;
  private shouldReconnect = false;
  private hasOpened = false;
  private onReconnect: (() => void) | undefined;
  private onInitialOpen: (() => void) | undefined;
  private onMalformed: ((frameType: string) => void) | undefined;
  private machineId = "local";
  private lastFrameAt = 0;

  /**
   * Drop a connection that has gone silent past the keepalive budget, so the
   * normal reconnect path (and the refresh it triggers) can run. Called when
   * the browser comes back to the foreground, which is exactly when a
   * connection that died while the tab was hidden needs to be noticed.
   */
  checkLiveness(now = Date.now()): void {
    const socket = this.socket;
    if (socket === undefined || !this.shouldReconnect) return;
    if (socket.readyState !== WebSocket.OPEN) return;
    if (this.lastFrameAt === 0 || now - this.lastFrameAt < LIVENESS_TIMEOUT_MS) return;
    // close() fires onclose, which schedules the reconnect; the reconnect
    // callback is what refetches everything missed while it was dead.
    closeSocketQuietly(socket);
  }

  /** Gap events counted on this socket's per-session scope since connect(). */
  get gapCount(): number {
    return this.seqMonitor.gapCount;
  }

  connect(
    session: SessionRef,
    onEvent: (event: SessionUiEvent) => void,
    onReconnect?: () => void,
    machineId = "local",
    onInitialOpen?: () => void,
    onMalformed?: (frameType: string) => void,
  ): void {
    this.close();
    this.machineId = machineId;
    this.session = session;
    this.onEvent = onEvent;
    this.onReconnect = onReconnect;
    this.onInitialOpen = onInitialOpen;
    this.onMalformed = onMalformed;
    this.shouldReconnect = true;
    this.open();
  }

  setHandler(onEvent: (event: SessionUiEvent) => void): void {
    this.onEvent = onEvent;
  }

  close(): void {
    this.shouldReconnect = false;
    window.clearTimeout(this.reconnectTimer);
    closeSocketQuietly(this.socket);
    this.socket = undefined;
    this.session = undefined;
    this.onEvent = undefined;
    this.onReconnect = undefined;
    this.onInitialOpen = undefined;
    this.onMalformed = undefined;
    this.hasOpened = false;
    this.machineId = "local";
  }

  private open(): void {
    const session = this.session;
    if (session === undefined || session.id === "" || session.cwd === "" || !this.shouldReconnect) return;
    const socket = sessionEvents(session, this.machineId);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.reconnectDelay = 500;
      this.lastFrameAt = Date.now();
      // Reconnect refetches everything, and a daemon restart resets the hub's
      // counter, so the first frame after an open says nothing about loss.
      this.seqMonitor.reset();
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
    };
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    window.clearTimeout(this.reconnectTimer);
    const delay = jitteredReconnectDelay(this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 5000);
    this.reconnectTimer = window.setTimeout(() => { this.open(); }, delay);
  }

  /**
   * The network is back: retry now instead of sitting out the rest of a
   * backoff window that was measured against a network that no longer exists.
   */
  reconnectNow(): void {
    if (!this.shouldReconnect || this.socket !== undefined) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectDelay = 500;
    this.open();
  }

  private async handleMessage(data: MessageEvent["data"], socket: WebSocket, session: SessionRef): Promise<void> {
    // Any frame is proof of life, including the keepalive, which parses to
    // nothing and is dropped below.
    if (this.socket === socket) this.lastFrameAt = Date.now();
    const raw = await parseSocketEvent(data);
    // Gap accounting reads the wire stamp, not the parsed event: the dedicated
    // validators (inbox, ask, dialog) rebuild the event and drop the seq, but a
    // frame lost there is lost all the same.
    this.seqMonitor.observe(raw);
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
  private readonly seqMonitor = new ScopeSeqMonitor("global");
  private onOpen: (() => void) | undefined;
  private reconnectTimer?: number;
  private reconnectDelay = 500;
  private shouldReconnect = false;
  private machineId = "local";
  private lastFrameAt = 0;

  /** Same liveness contract as SessionSocket; see checkLiveness there. */
  checkLiveness(now = Date.now()): void {
    const socket = this.socket;
    if (socket === undefined || !this.shouldReconnect) return;
    if (socket.readyState !== WebSocket.OPEN) return;
    if (this.lastFrameAt === 0 || now - this.lastFrameAt < LIVENESS_TIMEOUT_MS) return;
    closeSocketQuietly(socket);
  }

  /** Gap events counted on the global scope since this socket last opened. */
  get gapCount(): number {
    return this.seqMonitor.gapCount;
  }

  connect(onEvent: (event: BrowserRealtimeEvent) => void, onOpen?: () => void, machineId = "local"): void {
    this.close();
    this.machineId = machineId;
    this.onEvent = onEvent;
    this.onOpen = onOpen;
    this.shouldReconnect = true;
    this.open();
  }

  close(): void {
    this.shouldReconnect = false;
    window.clearTimeout(this.reconnectTimer);
    closeSocketQuietly(this.socket);
    this.socket = undefined;
    this.onEvent = undefined;
    this.onOpen = undefined;
    this.machineId = "local";
  }

  private open(): void {
    if (!this.shouldReconnect) return;
    const socket = realtimeEvents(this.machineId);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.reconnectDelay = 500;
      this.lastFrameAt = Date.now();
      this.seqMonitor.reset();
      this.onOpen?.();
    };
    socket.onmessage = (message) => void this.handleMessage(message.data, socket);
    socket.onerror = () => { socket.close(); };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    window.clearTimeout(this.reconnectTimer);
    const delay = jitteredReconnectDelay(this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 5000);
    this.reconnectTimer = window.setTimeout(() => { this.open(); }, delay);
  }

  /**
   * The network is back: retry now instead of sitting out the rest of a
   * backoff window that was measured against a network that no longer exists.
   */
  reconnectNow(): void {
    if (!this.shouldReconnect || this.socket !== undefined) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectDelay = 500;
    this.open();
  }

  private async handleMessage(data: MessageEvent["data"], socket: WebSocket): Promise<void> {
    if (this.socket === socket) this.lastFrameAt = Date.now();
    const raw = await parseSocketEvent(data);
    // Observed on the raw frame, before validation: a notifications.summary is
    // dropped from the typed event stream, but its stamp still costs a number
    // in the global sequence and must advance the client's last-seen with it.
    this.seqMonitor.observe(raw);
    const event = parseRealtimeSocketEvent(raw);
    if (this.socket === socket && event !== undefined) this.onEvent?.(event);
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
  // Inbox, ask, and dialog frames have dedicated validators (they drive the
  // notification inbox and the interactive cards answered on the model's or an
  // extension's behalf). Every other accepted frame is session stream
  // vocabulary, validated field by field.
  if (type === "notifications.inbox") return safelyParseValidatedEvent(() => parseSessionNotificationInboxEvent(event));
  if (type === "ask.opened") return safelyParseValidatedEvent(() => parseSessionAskOpenedEvent(event));
  if (type === "ask.closed") return safelyParseValidatedEvent(() => parseSessionAskClosedEvent(event));
  if (type === "dialog.opened") return safelyParseValidatedEvent(() => parseSessionDialogOpenedEvent(event));
  if (type === "dialog.closed") return safelyParseValidatedEvent(() => parseSessionDialogClosedEvent(event));
  const parsed = safelyParseValidatedEvent(() => parseSessionStreamEvent(event));
  return parsed === undefined ? undefined : withTransportSeq(parsed, event);
}

export function parseRealtimeSocketEvent(event: unknown): BrowserRealtimeEvent | undefined {
  const type = eventType(event);
  if (type === "sessions.unread") return safelyParseValidatedEvent(() => parseSessionUnreadEvent(event));
  if (type === "session.startup") return safelyParseValidatedEvent(() => parseSessionStartupProgressEvent(event));
  return safelyParseValidatedEvent(() => parseRealtimeStreamEvent(event));
}

// The hub stamps every per-session frame with a monotonic seq that the
// join-time exactly-once filter compares against the stream snapshot watermark.
// Validation rebuilds the event object, so the stamp must be carried over
// explicitly; a frame without a numeric stamp still flows, because the
// watermark filter fails open for unstamped events.
function withTransportSeq(event: SessionUiEvent, raw: unknown): SessionUiEvent {
  if (typeof raw !== "object" || raw === null || !("seq" in raw)) return event;
  const seq = raw.seq;
  return typeof seq === "number" ? { ...event, seq } : event;
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

  constructor(private readonly scope: string) {}

  /** Gap events recorded on this scope since the last {@link reset}. */
  get gapCount(): number {
    return this.gapEvents;
  }

  /** Forget the baseline: called on every (re)open, since a reconnect
   *  refetches the surface and a daemon restart restarts the counter. */
  reset(): void {
    this.lastSeen = undefined;
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
    console.warn(`[pi-web] ${this.scope} scope lost frames: expected ${String(last + 1)}, got ${String(seq)} (${String(seq - last - 1)} missing)`);
  }
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
