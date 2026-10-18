import type { RawData, WebSocket } from "ws";
import type { ServerFactMap, SessionScope } from "../../../server-plugin-api.js";
import { errorMessage, isRecord } from "../../../shared/unknownValues.js";
import { SERVER_FACTS_PATH, type ServerFactFeed, type ServerFactFeedSubscriber, type ServerFactLinkState, type SessionServerFact } from "../../shared/plugins/serverFactChannel.js";


export interface ServerFactRelayDaemon {
  connectWebSocket(path: string): WebSocket;
}

export interface ServerFactRelayLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
}

const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 5_000;
/** An upgrade the daemon accepted but never completed is cut after this long, and tried again. */
const HANDSHAKE_TIMEOUT_MS = 10_000;
/** A connection whose daemon has not answered the previous ping by the next one is half-open: it is cut, and its plugins hear the gap. */
const PING_INTERVAL_MS = 15_000;

/**
 * The daemon's facts, relayed into the web process. Linked only while the connection is open:
 * facts the daemon decides meanwhile are not queued or replayed, so the link going down and up
 * is what tells each web plugin it may have missed some (`facts.resumed`). A daemon restart
 * closes the connection, so it reads the same, and so does a connection the daemon stopped
 * answering (a handshake that never completes, a missed pong). Reconnects with a short capped
 * backoff until closed.
 */
export class ServerFactRelay implements ServerFactFeed {
  private readonly subscribers = new Set<ServerFactFeedSubscriber>();
  private socket: WebSocket | undefined;
  private open = false;
  private closed = false;
  private retryMs = RETRY_FIRST_MS;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private lastFailure: string | undefined;
  /** Each kind of frame this relay could not read, said once: a daemon newer than this web process sends facts it cannot parse. */
  private readonly unreadableFrames = new Set<string>();

  constructor(
    private readonly daemon: ServerFactRelayDaemon,
    private readonly logger: ServerFactRelayLogger,
  ) {}

  start(): void {
    if (this.closed || this.socket !== undefined) return;
    this.connect();
  }

  linked(): boolean {
    return this.open;
  }

  subscribe(subscriber: ServerFactFeedSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => { this.subscribers.delete(subscriber); };
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.socket?.terminate();
    this.socket = undefined;
    this.setLink("down");
  }

  private connect(): void {
    let socket: WebSocket;
    try {
      socket = this.daemon.connectWebSocket(SERVER_FACTS_PATH);
    } catch (error) {
      this.failed(errorMessage(error));
      this.retryLater();
      return;
    }
    this.socket = socket;
    let cutWithReason = false;
    const cut = (reason: string) => {
      cutWithReason = true;
      this.failed(reason);
      socket.terminate();
    };
    const handshake = setTimeout(() => { cut(`the session daemon did not complete the server facts relay handshake within ${String(HANDSHAKE_TIMEOUT_MS / 1000)} s`); }, HANDSHAKE_TIMEOUT_MS);
    handshake.unref();
    let pongOwed = false;
    let ping: ReturnType<typeof setInterval> | undefined;
    socket.on("open", () => {
      clearTimeout(handshake);
      this.retryMs = RETRY_FIRST_MS;
      this.lastFailure = undefined;
      this.setLink("up");
      ping = setInterval(() => {
        if (pongOwed) {
          cut("the session daemon stopped answering the server facts relay's ping");
          return;
        }
        pongOwed = true;
        socket.ping();
      }, PING_INTERVAL_MS);
      ping.unref();
    });
    socket.on("pong", () => { pongOwed = false; });
    socket.on("message", (data) => { this.relayFrame(data); });
    socket.on("unexpected-response", (_request, response) => {
      const status = response.statusCode;
      cut(status === 404 ? "the session daemon has no server facts relay route (HTTP 404); a daemon older than this web process needs a restart" : `the session daemon refused the server facts relay with HTTP ${String(status)}`);
    });
    socket.on("error", (error) => { if (!cutWithReason && !this.closed) this.failed(errorMessage(error)); });
    socket.on("close", () => {
      clearTimeout(handshake);
      clearInterval(ping);
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.setLink("down");
      this.retryLater();
    });
  }

  private relayFrame(data: RawData): void {
    const value = parseJson(frameText(data));
    const fact = parseServerFact(value);
    if (fact === undefined) {
      this.unreadable(value);
      return;
    }
    for (const subscriber of this.subscribers) subscriber.fact(fact);
  }

  /** A frame dropped because this relay cannot read it is said once per kind and reason, so a version skew does not read as silence. */
  private unreadable(value: unknown): void {
    const kind = isRecord(value) && typeof value["kind"] === "string" ? value["kind"] : undefined;
    const reason = unreadableReason(kind);
    const key = `${kind ?? ""}\n${reason}`;
    if (this.unreadableFrames.has(key)) return;
    this.unreadableFrames.add(key);
    this.logger.warn({ kind, reason }, "the server facts relay dropped a frame from the session daemon it cannot read");
  }

  private retryLater(): void {
    if (this.closed) return;
    this.retryTimer = setTimeout(() => { this.connect(); }, this.retryMs);
    this.retryTimer.unref();
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
  }

  /** Said once per distinct reason: a daemon that stays away is retried every few seconds. */
  private failed(reason: string): void {
    if (this.lastFailure === reason) return;
    this.lastFailure = reason;
    this.logger.warn({ reason }, "the server facts relay could not connect to the session daemon");
  }

  private setLink(state: ServerFactLinkState): void {
    const open = state === "up";
    if (this.open === open) return;
    this.open = open;
    this.logger.info({ link: state }, open ? "server facts relay connected to the session daemon" : "server facts relay lost the session daemon");
    for (const subscriber of this.subscribers) subscriber.link(state);
  }
}

function frameText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

function unreadableReason(kind: string | undefined): string {
  if (kind === undefined) return "not a fact";
  return isSessionFactKind(kind) ? "a field this web process cannot read" : "a kind this web process does not know";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

type SessionFactKind = SessionServerFact["kind"];

const SESSION_FACT_PARSERS: Readonly<Record<SessionFactKind, (value: Record<string, unknown>, session: SessionScope) => SessionServerFact | undefined>> = {
  "session.created": (value, session) => isCreatedReason(value["reason"]) ? { kind: "session.created", session, reason: value["reason"] } : undefined,
  "session.archived": (_value, session) => ({ kind: "session.archived", session }),
  "session.restored": (_value, session) => ({ kind: "session.restored", session }),
  "session.deleted": (_value, session) => ({ kind: "session.deleted", session }),
  "run.started": (_value, session) => ({ kind: "run.started", session }),
  "run.ended": (value, session) => {
    const outcome = value["outcome"];
    const error = value["error"];
    if (!isRunOutcome(outcome) || (error !== undefined && typeof error !== "string")) return undefined;
    return { kind: "run.ended", session, outcome, ...(error === undefined ? {} : { error }) };
  },
  "message.accepted": (value, session) => typeof value["clientMessageId"] === "string" ? { kind: "message.accepted", session, clientMessageId: value["clientMessageId"] } : undefined,
  "message.withdrawn": (value, session) => typeof value["clientMessageId"] === "string" ? { kind: "message.withdrawn", session, clientMessageId: value["clientMessageId"] } : undefined,
};

const CREATED_REASONS: Readonly<Record<ServerFactMap["session.created"]["reason"], true>> = { new: true, fork: true, clone: true, start: true };
const RUN_OUTCOMES: Readonly<Record<ServerFactMap["run.ended"]["outcome"], true>> = { completed: true, stopped: true, interrupted: true, failed: true };

function isCreatedReason(value: unknown): value is ServerFactMap["session.created"]["reason"] {
  return typeof value === "string" && Object.hasOwn(CREATED_REASONS, value);
}

function isRunOutcome(value: unknown): value is ServerFactMap["run.ended"]["outcome"] {
  return typeof value === "string" && Object.hasOwn(RUN_OUTCOMES, value);
}

function isSessionFactKind(value: unknown): value is SessionFactKind {
  return typeof value === "string" && Object.hasOwn(SESSION_FACT_PARSERS, value);
}

/** One relayed frame read back into a fact; anything else is dropped, never guessed at. */
function parseServerFact(value: unknown): SessionServerFact | undefined {
  if (!isRecord(value) || !isSessionFactKind(value["kind"])) return undefined;
  const session = parseSessionScope(value["session"]);
  return session === undefined ? undefined : SESSION_FACT_PARSERS[value["kind"]](value, session);
}

function parseSessionScope(value: unknown): SessionScope | undefined {
  if (!isRecord(value)) return undefined;
  const { machineId, sessionId, cwd, projectId, workspaceId } = value;
  if (machineId !== "local" || typeof sessionId !== "string" || typeof cwd !== "string") return undefined;
  if ((projectId !== undefined && typeof projectId !== "string") || (workspaceId !== undefined && typeof workspaceId !== "string")) return undefined;
  return {
    machineId,
    sessionId,
    cwd,
    ...(projectId === undefined ? {} : { projectId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  };
}
