/**
 * Session daemon state ownership.
 *
 * The session daemon is the authority over a pi-web instance's durable state:
 * projects, machines, session archives, and unread state all live in the data
 * directory, and the daemon is the only process allowed to own it while
 * running (the web/API process of the same instance shares the directory but
 * never claims it). A second daemon resolving the same data directory would
 * corrupt that state silently, so the daemon records its ownership in
 * `<data dir>/sessiond-owner.json` at startup and refuses to start while a
 * live owner holds the marker.
 *
 * The marker records the owner's PID namespace (see `sessiondOwnerNamespace`).
 * Inside the claimant's own namespace, liveness uses the owning process's
 * Linux `/proc` start-time ticks when both the marker and the probe have them:
 * the recorded value distinguishes the original owner from a reused pid, so
 * stale markers never block startup and live owners always do. Otherwise it
 * falls back to a `kill(pid, 0)` probe. A pid from another namespace (a
 * replica in another container on the same volume) cannot be probed at all,
 * so its owner is judged by a heartbeat lease instead: the owner rewrites
 * `heartbeatAt` every {@link OWNER_HEARTBEAT_PERIOD_MS}, and a claimant takes
 * over only after watching the value stay unchanged for {@link OWNER_LEASE_MS}.
 * Markers written before the lease carry no namespace and keep the pid probe,
 * and so does a marker this host wrote before it rebooted, or one written
 * without `/proc` read by a daemon without `/proc` (see
 * `sessiondOwnerNamespace`): a plain host starts exactly as it did before the
 * lease.
 *
 * Service and `tsx watch` restarts briefly overlap the outgoing daemon, so a
 * claimant that finds a live owner waits a short grace for the owner to
 * release (orderly shutdown removes the marker) before failing. When the
 * owner persists past the grace window, startup fails with a
 * {@link SessiondStateOwnershipConflictError} naming the owner and the
 * configuration a second instance needs: a distinct `PI_WEB_DATA_DIR`,
 * `PI_WEB_SESSIOND_SOCKET` (or `PI_WEB_SESSIOND_PORT` / `PI_WEB_SESSIOND_HOST`),
 * and web port.
 */

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { piWebDataDir } from "../../config.js";
import { sessiondEndpointDescription } from "../shared/sessiondClient/config.js";
import { isRecord } from "../../shared/unknownValues.js";
import {
  claimSettles,
  ownerNamespaceKey,
  parseOwnerNamespace,
  readOwnNamespace,
  readProcessStartTime,
  relateOwnerNamespace,
  type SessiondOwnerNamespace,
} from "./sessiondOwnerNamespace.js";

/** Marker file recording the owning daemon, inside the instance data directory. */
export const SESSIOND_OWNER_MARKER_FILENAME = "sessiond-owner.json";

/** The marker, or one of the temporary files a heartbeat renames over it. */
export function isOwnershipMarkerFileName(name: string): boolean {
  return name === SESSIOND_OWNER_MARKER_FILENAME
    || (name.startsWith(`${SESSIOND_OWNER_MARKER_FILENAME}.`) && name.endsWith(".tmp"));
}

/**
 * The lease is three heartbeat periods, so a live owner survives two slow or
 * failed writes (a busy event loop, a slow network volume) before it can look
 * stale. Staleness is measured on the claimant's monotonic clock by watching
 * the value change, never by comparing two hosts' wall clocks, so clock skew
 * cannot make a live owner look dead. 30 s is also the default Kubernetes
 * termination grace: a crash-recreate waits about as long as a normal stop.
 * One small write every 10 s is negligible on any volume.
 */
const OWNER_HEARTBEAT_PERIOD_MS = 10_000;
const OWNER_LEASE_MS = 30_000;

export interface SessiondStateOwnershipRecord {
  readonly pid: number;
  /** Wall-clock start of the owning daemon; for humans and release identity. */
  readonly startedAt: string;
  /**
   * Linux `/proc/<pid>/stat` start-time ticks of the owner, when readable. A
   * mismatch means the recorded pid now names a different process.
   */
  readonly processStartTime?: string;
  /** Human description of the daemon endpoint: socket path or host:port. */
  readonly endpoint: string;
  /** The PID namespace `pid` belongs to; absent in markers written before the lease. */
  readonly namespace?: SessiondOwnerNamespace;
  /** Owner's wall clock at its last heartbeat; only its changing matters to a claimant. */
  readonly heartbeatAt?: string;
}

type OwnerScope = "same-namespace" | "foreign-namespace";

const conflictExplanations: Record<OwnerScope, (owner: SessiondStateOwnershipRecord, markerPath: string, leaseMs: number) => string> = {
  "same-namespace": (owner, markerPath) =>
    `(pid ${String(owner.pid)}, started ${owner.startedAt}, listening on ${owner.endpoint}; ` +
    `ownership marker ${markerPath}). Two daemons sharing one data directory corrupt each other's state.\n\n`,
  "foreign-namespace": (owner, markerPath, leaseMs) =>
    `on host "${owner.namespace?.hostname ?? "unknown"}", in another container or on another host ` +
    `(pid ${String(owner.pid)} there, started ${owner.startedAt}, listening on ${owner.endpoint}, ` +
    `last heartbeat ${owner.heartbeatAt ?? "never"}; ownership marker ${markerPath}). ` +
    `Two daemons sharing one data directory corrupt each other's state.\n\n` +
    `Give every host its own data directory. Containers that share this volume must run one session daemon at a time: ` +
    `run a single replica and replace it with the Recreate strategy instead of a rolling update. If that daemon is gone, start again: ` +
    `a new daemon takes over once the heartbeat has not changed for ${String(Math.round(leaseMs / 1000))} seconds.\n\n`,
};

const conflictRemedies: Record<OwnerScope, (owner: SessiondStateOwnershipRecord) => string> = {
  "same-namespace": (owner) =>
    `If pid ${String(owner.pid)} is not a running pi-web session daemon, remove the stale marker file and start again.`,
  "foreign-namespace": () =>
    `Remove the marker file by hand only when no session daemon on that host uses this data directory.`,
};

/**
 * The daemon could not start because a live session daemon owns the state this
 * one resolved. The message is the user- and agent-facing remediation, so it
 * names the owner and the distinct configuration a second instance needs.
 */
export class SessiondStateOwnershipConflictError extends Error {
  readonly dataDir: string;
  readonly owner: SessiondStateOwnershipRecord;

  constructor(options: { dataDir: string; markerPath: string; owner: SessiondStateOwnershipRecord; scope: OwnerScope; leaseMs: number }) {
    const { dataDir, markerPath, owner, scope, leaseMs } = options;
    super(
      `another pi-web session daemon already owns this state\n\n` +
        `The data directory "${dataDir}" is owned by a live session daemon ` +
        conflictExplanations[scope](owner, markerPath, leaseMs) +
        `To run a second pi-web instance, give it its own state and endpoints:\n` +
        `- PI_WEB_DATA_DIR: a different data directory\n` +
        `- PI_WEB_SESSIOND_SOCKET (or PI_WEB_SESSIOND_PORT / PI_WEB_SESSIOND_HOST): a different session daemon endpoint\n` +
        `- PI_WEB_PORT: a different web/API port\n\n` +
        conflictRemedies[scope](owner),
    );
    this.name = "SessiondStateOwnershipConflictError";
    this.dataDir = dataDir;
    this.owner = owner;
  }
}

/**
 * Another daemon's claim replaced this daemon's in the marker while this one
 * still runs: every write from here on can corrupt the state the other daemon
 * now owns. The message names that owner so the operator can find it.
 */
export class SessiondStateOwnershipLostError extends Error {
  readonly markerPath: string;
  readonly owner: SessiondStateOwnershipRecord;

  constructor(options: { markerPath: string; owner: SessiondStateOwnershipRecord }) {
    const { markerPath, owner } = options;
    super(
      `another session daemon took over this daemon's state: the ownership marker ${markerPath} now records ` +
        `pid ${String(owner.pid)} on host "${owner.namespace?.hostname ?? "unrecorded"}" ` +
        `(PID namespace ${owner.namespace?.pidNamespace ?? "unrecorded"}, started ${owner.startedAt}, listening on ${owner.endpoint}). ` +
        `This daemon stops at once, without draining its sessions. It noticed the takeover at its first successful heartbeat check after it, ` +
        `so the two daemons may have shared the data directory for one or more heartbeat periods; check the state for conflicting writes.`,
    );
    this.name = "SessiondStateOwnershipLostError";
    this.markerPath = markerPath;
    this.owner = owner;
  }
}

export interface SessiondStateOwnershipLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
}

export interface ClaimSessiondStateOwnershipOptions {
  /** The captured pre-scrub daemon environment; resolves the data dir and endpoint. */
  readonly env: NodeJS.ProcessEnv;
  /** Test seam; defaults to the env-resolved data dir. */
  readonly dataDir?: string;
  readonly ownPid?: number;
  /** Test seam; defaults to {@link readOwnNamespace}. */
  readonly ownNamespace?: SessiondOwnerNamespace;
  /** Test seam; defaults to {@link isOwnershipRecordAlive}. */
  readonly isAlive?: (record: SessiondStateOwnershipRecord) => boolean;
  /** How long to wait for a live owner to release before failing. */
  readonly graceMs?: number;
  readonly pollIntervalMs?: number;
  /** Test seams; default to {@link OWNER_LEASE_MS} and {@link OWNER_HEARTBEAT_PERIOD_MS}. */
  readonly leaseMs?: number;
  readonly heartbeatPeriodMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly logger?: SessiondStateOwnershipLogger;
  /**
   * Called once, from a heartbeat, when the marker records another daemon's
   * claim. The heartbeat has stopped; the caller must stop serving and exit.
   */
  readonly onOwnershipLost: (error: SessiondStateOwnershipLostError) => void;
}

export interface SessiondStateOwnership {
  readonly markerPath: string;
  readonly record: SessiondStateOwnershipRecord;
  /**
   * Stop the heartbeat and remove the marker when it still records this
   * daemon; a no-op when another owner has taken over. Best-effort by
   * contract: a failed release only leaves a stale marker the next start
   * discards, so failures are logged, not thrown.
   */
  release(): Promise<void>;
}

const DEFAULT_GRACE_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

/** How long the owner's heartbeat has been watched by this claimant. */
interface OwnerHeartbeatObservation {
  /** The heartbeat or the claim changed while watched: a writer was alive moments ago. */
  readonly advanced: boolean;
  /** Claimant's monotonic time since the heartbeat last changed or was first seen. */
  readonly unchangedMs: number;
}

interface OwnerMarkerObservation {
  readonly marker: SessiondStateOwnershipRecord | "invalid" | undefined;
  readonly ownPid: number;
  readonly ownNamespace: SessiondOwnerNamespace;
  readonly isAlive: (record: SessiondStateOwnershipRecord) => boolean;
  readonly heartbeat: OwnerHeartbeatObservation;
  readonly leaseMs: number;
}

type MarkerFileVerdict = "absent" | "unreadable";
type OwnedMarkerVerdict =
  | "own-previous"
  | "same-namespace-alive"
  | "same-namespace-dead"
  | "previous-boot"
  | "foreign-unconfirmed"
  | "foreign-fresh"
  | "foreign-stale";

type OwnerMarkerVerdict =
  | { readonly kind: MarkerFileVerdict }
  | { readonly kind: OwnedMarkerVerdict; readonly owner: SessiondStateOwnershipRecord };

/**
 * What a starting daemon finds in the ownership marker.
 *
 * A marker without a namespace (written before the lease) or from this
 * namespace is judged by its pid, as on any plain host. A marker this host
 * wrote before it rebooted names a process that cannot be running: its pid
 * and start ticks may repeat in a deterministic boot, so it is not probed. A
 * marker from another namespace is judged only by its heartbeat: fresh once
 * the heartbeat or the claim has changed while watched, stale once neither
 * has changed for the lease, unconfirmed before either. A foreign pid is never
 * probed: in this process table it names an unrelated process or none.
 */
export function classifyOwnerMarker(observation: OwnerMarkerObservation): OwnerMarkerVerdict {
  const { marker } = observation;
  if (marker === undefined) return { kind: "absent" };
  if (marker === "invalid") return { kind: "unreadable" };
  const relation = marker.namespace === undefined ? "same" : relateOwnerNamespace(marker.namespace, observation.ownNamespace);
  if (relation === "previous-boot") return { kind: "previous-boot", owner: marker };
  if (relation === "foreign") {
    if (observation.heartbeat.unchangedMs >= observation.leaseMs) return { kind: "foreign-stale", owner: marker };
    return { kind: observation.heartbeat.advanced ? "foreign-fresh" : "foreign-unconfirmed", owner: marker };
  }
  if (marker.pid === observation.ownPid) return { kind: "own-previous", owner: marker };
  return { kind: observation.isAlive(marker) ? "same-namespace-alive" : "same-namespace-dead", owner: marker };
}

/**
 * `create` claims an absent marker exclusively, `replace` removes the marker
 * first (a takeover), and `wait` polls again. Refusals throw.
 */
type ClaimAction = "create" | "replace" | "wait";

interface ClaimStep {
  readonly dataDir: string;
  readonly markerPath: string;
  readonly pastGrace: boolean;
  readonly leaseMs: number;
  readonly logger: SessiondStateOwnershipLogger | undefined;
  warnOnce(details: Record<string, unknown>, message: string): void;
}

const markerFileExecutors: Record<MarkerFileVerdict, (step: ClaimStep) => ClaimAction> = {
  absent: () => "create",
  unreadable: (step) => {
    if (!step.pastGrace) return "wait";
    step.logger?.warn({ markerPath: step.markerPath }, "discarding an unreadable session daemon ownership marker");
    return "replace";
  },
};

const ownedMarkerExecutors: Record<OwnedMarkerVerdict, (owner: SessiondStateOwnershipRecord, step: ClaimStep) => ClaimAction> = {
  "own-previous": () => "replace",
  "same-namespace-alive": (owner, step) =>
    waitForOwnerOrRefuse(owner, step, "same-namespace", "another live session daemon owns this state; waiting briefly for it to release ownership"),
  "same-namespace-dead": (owner, step) => {
    step.logger?.info({ markerPath: step.markerPath, previousOwner: owner }, "taking over session daemon state ownership from a stale marker");
    return "replace";
  },
  "previous-boot": (owner, step) => {
    step.logger?.info(
      { markerPath: step.markerPath, previousOwner: owner },
      "taking over session daemon state ownership from a marker this host wrote before it restarted",
    );
    return "replace";
  },
  "foreign-unconfirmed": (owner, step) => {
    step.warnOnce(
      { markerPath: step.markerPath, owner, leaseMs: step.leaseMs },
      "a session daemon in another PID namespace owns this state; watching its heartbeat before taking over",
    );
    return "wait";
  },
  "foreign-fresh": (owner, step) =>
    waitForOwnerOrRefuse(owner, step, "foreign-namespace", "a live session daemon in another PID namespace owns this state; waiting briefly for it to release ownership"),
  "foreign-stale": (owner, step) => {
    step.logger?.warn(
      { markerPath: step.markerPath, previousOwner: owner, leaseMs: step.leaseMs },
      "taking over session daemon state ownership from another PID namespace whose heartbeat stopped",
    );
    return "replace";
  },
};

function waitForOwnerOrRefuse(owner: SessiondStateOwnershipRecord, step: ClaimStep, scope: OwnerScope, waitingMessage: string): ClaimAction {
  if (step.pastGrace) {
    throw new SessiondStateOwnershipConflictError({ dataDir: step.dataDir, markerPath: step.markerPath, owner, scope, leaseMs: step.leaseMs });
  }
  step.warnOnce({ markerPath: step.markerPath, owner }, waitingMessage);
  return "wait";
}

/**
 * Claim ownership of the instance data directory for this daemon.
 *
 * Resolves once the marker records this daemon and its heartbeat runs; throws
 * {@link SessiondStateOwnershipConflictError} when a live owner persists past
 * the grace window. The caller binds its endpoint only after this resolves.
 */
export async function claimSessiondStateOwnership(options: ClaimSessiondStateOwnershipOptions): Promise<SessiondStateOwnership> {
  const ownPid = options.ownPid ?? process.pid;
  const ownNamespace = options.ownNamespace ?? readOwnNamespace();
  const isAlive = options.isAlive ?? isOwnershipRecordAlive;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const leaseMs = options.leaseMs ?? OWNER_LEASE_MS;
  const heartbeatPeriodMs = options.heartbeatPeriodMs ?? OWNER_HEARTBEAT_PERIOD_MS;
  const sleep = options.sleep ?? defaultSleep;
  const logger = options.logger;
  const dataDir = options.dataDir ?? piWebDataDir(options.env);
  const markerPath = join(dataDir, SESSIOND_OWNER_MARKER_FILENAME);
  const processStartTime = readProcessStartTime(ownPid);
  const startedAt = new Date().toISOString();
  const record: SessiondStateOwnershipRecord = {
    pid: ownPid,
    startedAt,
    ...(processStartTime === undefined ? {} : { processStartTime }),
    endpoint: sessiondEndpointDescription(options.env),
    namespace: ownNamespace,
    heartbeatAt: startedAt,
  };
  await mkdir(dataDir, { recursive: true });
  const deadline = performance.now() + graceMs;
  const warned = new Set<string>();
  const warnOnce = (details: Record<string, unknown>, message: string): void => {
    if (warned.has(message)) return;
    warned.add(message);
    logger?.warn(details, message);
  };
  const settleMs = claimSettles(ownNamespace) ? pollIntervalMs * 4 : 0;
  let heartbeatWatch: OwnerHeartbeatWatch | undefined;
  let readFailingSince: number | undefined;

  for (;;) {
    let existing: SessiondStateOwnershipRecord | "invalid" | undefined;
    try {
      existing = await readOwnershipRecord(markerPath);
      readFailingSince = undefined;
    } catch (error) {
      readFailingSince ??= performance.now();
      if (performance.now() - readFailingSince >= graceMs) throw error;
      warnOnce({ err: error, markerPath }, "could not read the session daemon ownership marker; retrying");
      await sleep(pollIntervalMs);
      continue;
    }
    const now = performance.now();
    heartbeatWatch = nextHeartbeatWatch(heartbeatWatch, existing, now);
    const verdict = classifyOwnerMarker({
      marker: existing,
      ownPid,
      ownNamespace,
      isAlive,
      heartbeat: heartbeatWatch === undefined
        ? { advanced: false, unchangedMs: 0 }
        : { advanced: heartbeatWatch.advanced, unchangedMs: now - heartbeatWatch.since },
      leaseMs,
    });
    const step: ClaimStep = { dataDir, markerPath, pastGrace: now >= deadline, leaseMs, logger, warnOnce };
    const action = "owner" in verdict
      ? ownedMarkerExecutors[verdict.kind](verdict.owner, step)
      : markerFileExecutors[verdict.kind](step);
    if (action === "wait") {
      await sleep(pollIntervalMs);
      continue;
    }
    if (action === "replace") await rm(markerPath, { force: true });
    if (!(await createOwnershipMarker(markerPath, record, logger))) continue;
    if (settleMs > 0 && !(await stillOwnsAfterSettling(markerPath, record, sleep, settleMs))) {
      logger?.info({ markerPath }, "another session daemon claimed this state at the same moment; re-evaluating ownership");
      continue;
    }
    const heartbeat = startOwnerHeartbeat({ markerPath, record, periodMs: heartbeatPeriodMs, logger, onOwnershipLost: options.onOwnershipLost });
    return {
      markerPath,
      record,
      release: async () => {
        await heartbeat.stop();
        await releaseOwnershipMarker(markerPath, record, logger);
      },
    };
  }
}

interface OwnerHeartbeatWatch {
  readonly claim: string;
  readonly heartbeatAt: string | undefined;
  /** Claimant's monotonic time when this heartbeat value was first seen. */
  readonly since: number;
  readonly advanced: boolean;
}

/**
 * An absent marker ends the watch; an unreadable read keeps it, so a torn or
 * flaky read cannot restart the lease. A new claim or a new heartbeat value
 * seen while watching is a live writer: a claim that keeps changing must end
 * in a refusal, not in a wait that restarts with every change.
 */
function nextHeartbeatWatch(
  previous: OwnerHeartbeatWatch | undefined,
  marker: SessiondStateOwnershipRecord | "invalid" | undefined,
  now: number,
): OwnerHeartbeatWatch | undefined {
  if (marker === undefined) return undefined;
  if (marker === "invalid") return previous;
  const claim = ownershipClaimKey(marker);
  if (previous === undefined) return { claim, heartbeatAt: marker.heartbeatAt, since: now, advanced: false };
  if (previous.claim === claim && previous.heartbeatAt === marker.heartbeatAt) return previous;
  return { claim, heartbeatAt: marker.heartbeatAt, since: now, advanced: true };
}

/** One daemon's claim: a pid is only unique together with its start and namespace. */
function ownershipClaimKey(record: SessiondStateOwnershipRecord): string {
  return JSON.stringify([record.pid, record.startedAt, record.namespace === undefined ? null : ownerNamespaceKey(record.namespace)]);
}

type HeldMarkerVerdict = "held" | "missing" | "unreadable";

type HeartbeatMarkerVerdict =
  | { readonly kind: HeldMarkerVerdict }
  | { readonly kind: "taken-over"; readonly owner: SessiondStateOwnershipRecord };

/**
 * What the owner finds in its marker at a heartbeat. Only a readable marker
 * recording another claim proves a takeover. A missing marker (an operator's
 * `rm`, a claimant between its removal and its create) is re-asserted with an
 * exclusive create, so a claim created meanwhile wins and the next beat sees
 * it; an unreadable one is re-checked on the next beat: neither is proof, and
 * exiting on a transient state would end every session for nothing.
 */
function classifyHeartbeatMarker(current: SessiondStateOwnershipRecord | "invalid" | undefined, claim: string): HeartbeatMarkerVerdict {
  if (current === undefined) return { kind: "missing" };
  if (current === "invalid") return { kind: "unreadable" };
  return ownershipClaimKey(current) === claim ? { kind: "held" } : { kind: "taken-over", owner: current };
}

/**
 * Rewrite `heartbeatAt` every period while the marker records this daemon.
 * Each write replaces the marker by rename, so a claimant never reads a torn
 * heartbeat. A failed read or write is logged and retried on the next
 * period: the lease outlasts two missed beats. A marker recording another
 * claim stops the heartbeat and hands the loss to the caller; overwriting it
 * would hide that two daemons now share the state.
 */
function startOwnerHeartbeat(options: {
  markerPath: string;
  record: SessiondStateOwnershipRecord;
  periodMs: number;
  logger: SessiondStateOwnershipLogger | undefined;
  onOwnershipLost: (error: SessiondStateOwnershipLostError) => void;
}): { stop(): Promise<void> } {
  const { markerPath, record, periodMs, logger, onOwnershipLost } = options;
  const claim = ownershipClaimKey(record);
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;

  const refresh = async (): Promise<void> => {
    if (stopped) return;
    try {
      await writeMarkerByRename(markerPath, { ...record, heartbeatAt: new Date().toISOString() }, logger);
    } catch (error) {
      logger?.warn({ err: error, markerPath }, "could not refresh the session daemon ownership heartbeat; retrying next period");
    }
  };
  const reassert = async (): Promise<void> => {
    if (stopped) return;
    try {
      await createOwnershipMarker(markerPath, { ...record, heartbeatAt: new Date().toISOString() }, logger);
    } catch (error) {
      logger?.warn({ err: error, markerPath }, "could not write the session daemon ownership marker back; retrying next period");
    }
  };
  const heldMarkerExecutors: Record<HeldMarkerVerdict, () => Promise<void> | void> = {
    held: refresh,
    missing: async () => {
      logger?.warn({ markerPath }, "the session daemon ownership marker is missing; writing it back");
      await reassert();
    },
    unreadable: () => {
      logger?.warn({ markerPath }, "the session daemon ownership marker is unreadable; checking again next period");
    },
  };
  const beat = async (): Promise<void> => {
    let current: SessiondStateOwnershipRecord | "invalid" | undefined;
    try {
      current = await readOwnershipRecord(markerPath);
    } catch (error) {
      logger?.warn({ err: error, markerPath }, "could not read the session daemon ownership marker; checking again next period");
      return;
    }
    const verdict = classifyHeartbeatMarker(current, claim);
    if ("owner" in verdict) {
      stopped = true;
      onOwnershipLost(new SessiondStateOwnershipLostError({ markerPath, owner: verdict.owner }));
      return;
    }
    await heldMarkerExecutors[verdict.kind]();
  };
  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = beat().finally(schedule);
    }, periodMs);
    timer.unref();
  };
  schedule();

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    },
  };
}

/** Exclusive create; `false` when another claimant won the race, whose marker the loop then re-evaluates. */
async function createOwnershipMarker(
  markerPath: string,
  record: SessiondStateOwnershipRecord,
  logger: SessiondStateOwnershipLogger | undefined,
): Promise<boolean> {
  try {
    await writeDurably(markerPath, serializeOwnershipRecord(record), "wx", logger);
    return true;
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) return false;
    throw error;
  }
}

/**
 * Containers only (see `claimSettles`); a plain host or a WSL distro never
 * settles. Replicas on a shared volume can both believe they won: a takeover removes a marker it read earlier, so
 * a second claimant that read the same stale marker (two replicas recreated
 * together wait out the same lease) may remove this one in turn, and an
 * exclusive create is not atomic on every network volume. Waiting a few polls
 * lets the other claimant's marker land before this one trusts its claim. A
 * failed re-read is not proof either way, so the claim loop decides again.
 */
async function stillOwnsAfterSettling(
  markerPath: string,
  record: SessiondStateOwnershipRecord,
  sleep: (ms: number) => Promise<void>,
  settleMs: number,
): Promise<boolean> {
  await sleep(settleMs);
  try {
    const current = await readOwnershipRecord(markerPath);
    return typeof current === "object" && ownershipClaimKey(current) === ownershipClaimKey(record);
  } catch {
    return false;
  }
}

async function writeMarkerByRename(
  markerPath: string,
  record: SessiondStateOwnershipRecord,
  logger: SessiondStateOwnershipLogger | undefined,
): Promise<void> {
  const temporaryPath = `${markerPath}.${randomUUID()}.tmp`;
  try {
    await writeDurably(temporaryPath, serializeOwnershipRecord(record), "w", logger);
    await rename(temporaryPath, markerPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

let refusedSyncReported = false;

/**
 * Flushed before the marker becomes the one claimants read: after a power
 * loss, XFS (and likely NTFS) can show a file renamed or created just before
 * it as empty, which costs the next start the unreadable-marker grace. A
 * rewrite every heartbeat makes that window recur, so every marker write
 * syncs. The sync only narrows that window: a filesystem that refuses it
 * (some shared folders answer EINVAL) still holds the written marker, so a
 * failed sync is a warning, never a failed claim or beat. Such a filesystem
 * refuses every sync, so the warning is logged once per process rather than
 * at every heartbeat.
 */
async function writeDurably(path: string, content: string, flag: "w" | "wx", logger: SessiondStateOwnershipLogger | undefined): Promise<void> {
  const handle = await open(path, flag);
  try {
    await handle.writeFile(content);
    await handle.sync().catch((error: unknown) => {
      if (refusedSyncReported) return;
      refusedSyncReported = true;
      logger?.warn({ err: error, path }, "could not sync the session daemon ownership marker to disk; continuing without the sync, and not reporting it again");
    });
  } finally {
    await handle.close();
  }
}

function serializeOwnershipRecord(record: SessiondStateOwnershipRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** Parse marker content; `"invalid"` when it is not a readable ownership record. */
export function parseOwnershipRecord(content: string): SessiondStateOwnershipRecord | "invalid" {
  try {
    const value: unknown = JSON.parse(content);
    if (!isRecord(value)) return "invalid";
    if (typeof value["pid"] !== "number" || typeof value["startedAt"] !== "string" || typeof value["endpoint"] !== "string") {
      return "invalid";
    }
    if (value["processStartTime"] !== undefined && typeof value["processStartTime"] !== "string") return "invalid";
    if (value["heartbeatAt"] !== undefined && typeof value["heartbeatAt"] !== "string") return "invalid";
    const namespace = value["namespace"] === undefined ? undefined : parseOwnerNamespace(value["namespace"]);
    if (namespace === "invalid") return "invalid";
    return {
      pid: value["pid"],
      startedAt: value["startedAt"],
      ...(value["processStartTime"] === undefined ? {} : { processStartTime: value["processStartTime"] }),
      endpoint: value["endpoint"],
      ...(namespace === undefined ? {} : { namespace }),
      ...(value["heartbeatAt"] === undefined ? {} : { heartbeatAt: value["heartbeatAt"] }),
    };
  } catch {
    return "invalid";
  }
}

/**
 * Whether the process a marker records is still that same running process.
 *
 * With both the recorded and the current `/proc` start time available, a
 * mismatch pins down pid reuse; otherwise the pid probe is all there is.
 */
export function isOwnershipRecordAlive(record: Pick<SessiondStateOwnershipRecord, "pid" | "processStartTime">): boolean {
  const currentStartTime = readProcessStartTime(record.pid);
  if (currentStartTime !== undefined && record.processStartTime !== undefined) {
    return currentStartTime === record.processStartTime;
  }
  return isProcessAlive(record.pid);
}

async function readOwnershipRecord(markerPath: string): Promise<SessiondStateOwnershipRecord | "invalid" | undefined> {
  let content: string;
  try {
    content = await readFile(markerPath, "utf8");
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
  return parseOwnershipRecord(content);
}

async function releaseOwnershipMarker(
  markerPath: string,
  record: SessiondStateOwnershipRecord,
  logger: SessiondStateOwnershipLogger | undefined,
): Promise<void> {
  try {
    const current = await readOwnershipRecord(markerPath);
    if (typeof current !== "object") return;
    // Remove only our own marker: a newer owner that reused the pid after a
    // takeover race, here or in another namespace, is safe from deletion.
    if (ownershipClaimKey(current) === ownershipClaimKey(record)) {
      await rm(markerPath, { force: true });
    }
  } catch (error) {
    logger?.warn({ err: error, markerPath }, "could not release the session daemon ownership marker; the next start discards it as stale");
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return isErrorCode(error, "EPERM");
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error["code"] === code;
}
