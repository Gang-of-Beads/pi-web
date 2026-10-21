import type { RawData, WebSocket } from "ws";
import type { ServerFactMap, SessionScope } from "../../../server-plugin-api.js";
import { errorMessage, isRecord } from "../../../shared/unknownValues.js";
import { parsePiWebRuntimeComponent } from "../../../shared/piWebStatusParsing.js";
import { REQUEST_TIMEOUT_MS } from "../../../shared/requestTiming.js";
import { SERVER_FACTS_PATH, type ServerFactFeed, type ServerFactFeedSubscriber, type ServerFactLinkState, type SessionServerFact } from "../../shared/plugins/serverFactChannel.js";
import { comparePackageVersions } from "../../shared/piWebStatus.js";
import type { SessionDaemonRequestClient } from "../../shared/sessiondClient/sessionDaemonClient.js";


export interface ServerFactRelayDaemon extends SessionDaemonRequestClient {
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
/** The first release whose session daemon serves the server facts route; an older daemon answers its upgrade 404. */
const FIRST_FACTS_ROUTE_VERSION = "2.202610.15";
/** How often a relay parked on a daemon without the route reads its `/runtime` to see it restart; the daemon does not log requests. */
const PARKED_POLL_MS = 5_000;
const PARKED_RETRY_FIRST_MS = 5_000;
const PARKED_RETRY_MAX_MS = 5 * 60_000;
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/u;

/** The connect failures that mean no daemon is listening; any other failure, a timeout included, is a daemon that has not answered yet. */
const DAEMON_ABSENT_CODES: ReadonlySet<unknown> = new Set(["ECONNREFUSED", "ENOENT"]);

/** `absent`: nothing listens; `silent`: no answer yet (a stalled daemon); `answered`: with its version when it gave one. */
type DaemonRuntimeReading = { kind: "absent" } | { kind: "silent" } | { kind: "answered"; version: string | undefined };
type FactsRouteVerdict = "missing" | "try" | "ask-again";
type ParkedTick = "daemon-restarted" | "retry-due" | "wait";
type MissingRouteReason = "daemon version" | "upgrade answered 404";

interface ParkedRelay {
  version: string | undefined;
  retryAt: number;
}

function answeredVersion(reading: DaemonRuntimeReading): string | undefined {
  return reading.kind === "answered" ? reading.version : undefined;
}

function isReleaseOlderThanFactsRoute(version: string | undefined): boolean {
  return version !== undefined && RELEASE_VERSION.test(version) && (comparePackageVersions(version, FIRST_FACTS_ROUTE_VERSION) ?? 0) < 0;
}

/**
 * Only a release version older than the first with the route says it is missing; a dev or
 * prerelease version, none, or no daemon at all is tried. A daemon that has not answered is asked
 * again rather than sent an upgrade: a stalled old daemon would write its 404 to a relay that had
 * already given up, which is how one died (2026-10-21).
 */
function factsRouteVerdict(reading: DaemonRuntimeReading): FactsRouteVerdict {
  if (reading.kind === "silent") return "ask-again";
  return isReleaseOlderThanFactsRoute(answeredVersion(reading)) ? "missing" : "try";
}

/**
 * Only an answer with another known version is a restart worth connecting at once. A daemon that
 * went away and came back at the same or no version keeps the backoff, so an unguarded daemon the
 * upgrade crashed and its service manager restarted is not upgraded again every poll, and a
 * versionless answer (the 503 of a draining daemon) or no answer waits.
 */
function parkedTick(parked: ParkedRelay, reading: DaemonRuntimeReading, now: number): ParkedTick {
  if (reading.kind !== "answered") return "wait";
  if (reading.version !== undefined && reading.version !== parked.version) return "daemon-restarted";
  return now >= parked.retryAt ? "retry-due" : "wait";
}

function errorCode(error: unknown): unknown {
  if (!isRecord(error)) return undefined;
  return error["code"] ?? (isRecord(error["cause"]) ? error["cause"]["code"] : undefined);
}

/**
 * The daemon's facts, relayed into the web process. Linked only while the connection is open:
 * facts the daemon decides meanwhile are not queued or replayed, so the link going down and up
 * is what tells each web plugin it may have missed some (`facts.resumed`). A daemon restart
 * closes the connection, so it reads the same, and so does a connection the daemon stopped
 * answering (a handshake that never completes, a missed pong). Reconnects with a short capped
 * backoff until closed.
 *
 * A daemon older than the facts route answers the upgrade 404, and a .14 daemon died of the 404
 * it wrote to a relay that had already hung up (2026-10-21). So each attempt reads the daemon's
 * `/runtime` first, and a daemon whose version or 404 says it has no route parks the relay: said
 * once at info, retried with a backoff capped at 5 minutes, and connected at once when the daemon
 * restarts onto another version, which a parked relay sees through a cheap `/runtime` read.
 */
export class ServerFactRelay implements ServerFactFeed {
  private readonly subscribers = new Set<ServerFactFeedSubscriber>();
  private socket: WebSocket | undefined;
  private open = false;
  private closed = false;
  private retryMs = RETRY_FIRST_MS;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private readonly stopping = new AbortController();
  private parked: ParkedRelay | undefined;
  private parkedRetryMs = PARKED_RETRY_FIRST_MS;
  private readonly missingRouteSaid = new Set<string>();
  private lastFailure: string | undefined;
  /** Each kind of frame this relay could not read, said once: a daemon newer than this web process sends facts it cannot parse. */
  private readonly unreadableFrames = new Set<string>();

  constructor(
    private readonly daemon: ServerFactRelayDaemon,
    private readonly logger: ServerFactRelayLogger,
  ) {}

  start(): void {
    if (this.closed || this.started) return;
    this.started = true;
    void this.attempt();
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
    this.stopping.abort();
    clearTimeout(this.retryTimer);
    this.socket?.terminate();
    this.socket = undefined;
    this.setLink("down");
  }

  private readonly afterRuntimeRead: Readonly<Record<FactsRouteVerdict, (reading: DaemonRuntimeReading) => void>> = {
    missing: (reading) => { this.park(reading, "daemon version"); },
    try: (reading) => { this.connect(reading); },
    "ask-again": () => {
      this.failed("the session daemon did not answer the server facts relay's runtime check");
      this.retryLater();
    },
  };

  private readonly onParkedTick: Readonly<Record<ParkedTick, (reading: DaemonRuntimeReading, parked: ParkedRelay) => void>> = {
    "daemon-restarted": (reading) => {
      this.parked = undefined;
      this.parkedRetryMs = PARKED_RETRY_FIRST_MS;
      this.afterRuntimeRead[factsRouteVerdict(reading)](reading);
    },
    "retry-due": (reading, parked) => {
      this.parked = undefined;
      const decided: DaemonRuntimeReading = { kind: "answered", version: answeredVersion(reading) ?? parked.version };
      this.afterRuntimeRead[factsRouteVerdict(decided)](decided);
    },
    wait: () => { this.pollParkedLater(); },
  };

  private async attempt(): Promise<void> {
    const reading = await this.readRuntime();
    if (this.closed) return;
    this.afterRuntimeRead[factsRouteVerdict(reading)](reading);
  }

  private async readRuntime(): Promise<DaemonRuntimeReading> {
    try {
      const signal = AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), this.stopping.signal]);
      const answer = await this.daemon.request("GET", "/runtime", undefined, { signal });
      if (answer.statusCode < 200 || answer.statusCode >= 300) return { kind: "answered", version: undefined };
      return { kind: "answered", version: parsePiWebRuntimeComponent(parseJson(answer.body))?.runtimeVersion };
    } catch (error) {
      return DAEMON_ABSENT_CODES.has(errorCode(error)) ? { kind: "absent" } : { kind: "silent" };
    }
  }

  private park(reading: DaemonRuntimeReading, reason: MissingRouteReason): void {
    const version = answeredVersion(reading);
    this.sayMissingRoute(version, reason);
    this.parked = { version, retryAt: Date.now() + this.parkedRetryMs };
    this.parkedRetryMs = Math.min(this.parkedRetryMs * 2, PARKED_RETRY_MAX_MS);
    this.pollParkedLater();
  }

  private pollParkedLater(): void {
    if (this.closed) return;
    this.retryTimer = setTimeout(() => { void this.pollParked(); }, PARKED_POLL_MS);
    this.retryTimer.unref();
  }

  private async pollParked(): Promise<void> {
    const parked = this.parked;
    if (parked === undefined) return;
    const reading = await this.readRuntime();
    if (this.closed) return;
    this.onParkedTick[parkedTick(parked, reading, Date.now())](reading, parked);
  }

  /** Said once per daemon version and reason: a parked relay keeps retrying, and only a new daemon is news. */
  private sayMissingRoute(runtimeVersion: string | undefined, reason: MissingRouteReason): void {
    const key = `${runtimeVersion ?? ""}\n${reason}`;
    if (this.missingRouteSaid.has(key)) return;
    this.missingRouteSaid.add(key);
    this.logger.info(
      { runtimeVersion, reason, firstVersionWithRoute: FIRST_FACTS_ROUTE_VERSION },
      "the session daemon has no server facts route; the relay waits for it to restart onto a newer version",
    );
  }

  private connect(reading: DaemonRuntimeReading): void {
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
      this.parkedRetryMs = PARKED_RETRY_FIRST_MS;
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
    let missingRoute = false;
    socket.on("unexpected-response", (_request, response) => {
      const status = response.statusCode;
      if (status !== 404) {
        cut(`the session daemon refused the server facts relay with HTTP ${String(status)}`);
        return;
      }
      missingRoute = true;
      cutWithReason = true;
      socket.terminate();
    });
    socket.on("error", (error) => { if (!cutWithReason && !this.closed) this.failed(errorMessage(error)); });
    socket.on("close", () => {
      clearTimeout(handshake);
      clearInterval(ping);
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.setLink("down");
      if (missingRoute) this.park(reading, "upgrade answered 404");
      else this.retryLater();
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
    this.retryTimer = setTimeout(() => { void this.attempt(); }, this.retryMs);
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
