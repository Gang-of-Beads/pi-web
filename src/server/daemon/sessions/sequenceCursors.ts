/**
 * Where each device's operation log stands on this machine (docs/design/message-states.md,
 * "Order").
 *
 * A device - one browser tab - numbers every operation it asks one session to run - a message, a
 * take-back, a command, a shell command - 1, 2, 3, taking each number when the operation is first
 * sent, and resends what is not answered, in order. The machine keeps, per session and device,
 * the highest number it has applied, so an operation that arrives ahead of an earlier one that has
 * not arrived is refused instead of run out of order: the reader's second message could never be
 * queued while the first was still on the wire, which is how a later message read "Queued" above
 * an earlier one that read "Not received".
 *
 * A request also says the highest number its device saw confirmed (`ackedThrough`, a recorded
 * value); the cursor is the higher of that and what is on file. A lost file, or one written in an
 * older shape, loses only the number check for what was applied above that; the identity check
 * (the acceptance ledger) still keeps an operation from running twice. The verdict is decided
 * before the operation runs and recorded only once it is accepted, so an operation refused for its
 * content takes no number.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * `next`: the operation after the last one applied, so it runs. Behind the cursor, the identity
 * decides: `repeat` is one applied before, answered from what it came to and run nothing twice;
 * `rerun` is one a restart lost before the agent read it (the ledger says `unknown`), so it runs
 * again; `stale` is an operation the machine has never seen under a number already used, refused
 * so the device numbers it again. `gap`: an earlier operation has not arrived, so it is refused.
 */
export type SequenceVerdictKind = "next" | "repeat" | "rerun" | "stale" | "gap";

/** What the machine knows of an operation's identity: run and settled, lost to a restart, or never seen. */
export type IdentityStanding = "known" | "lost" | "unseen";

export interface SequencedOperation {
  readonly deviceId: string;
  readonly seq: number;
  readonly ackedThrough: number;
}

/** Where the operation falls against the next number expected: behind it, at it, or past it. */
export type Place = "behind" | "next" | "past";

const PLACE_BY_SIGN: Readonly<Record<string, Place>> = { "-1": "behind", "0": "next", "1": "past" };

const BEHIND_BY_IDENTITY: Readonly<Record<IdentityStanding, SequenceVerdictKind>> = { known: "repeat", lost: "rerun", unseen: "stale" };

const VERDICT_BY_PLACE: Readonly<Record<Place, (identity: () => IdentityStanding) => SequenceVerdictKind>> = {
  behind: (identity) => BEHIND_BY_IDENTITY[identity()],
  next: () => "next",
  past: () => "gap",
};

function placeOf(applied: number, seq: number): Place {
  return PLACE_BY_SIGN[String(Math.sign(seq - (applied + 1)))] ?? "past";
}

/** `identity` is asked only for an operation behind the cursor: looking it up can mean reading the session file. */
export function sequenceVerdict(applied: number, seq: number, identity: () => IdentityStanding): SequenceVerdictKind {
  return VERDICT_BY_PLACE[placeOf(applied, seq)](identity);
}

/** Refused because an earlier operation from this device has not arrived. */
export class SequenceGapError extends Error {
  constructor(readonly appliedThrough: number) {
    super(`An earlier operation from this device has not arrived; applied through ${String(appliedThrough)}`);
    this.name = "SequenceGapError";
  }
}

/** Refused because its number is already used and the machine has never seen this operation. */
export class SequenceStaleError extends Error {
  constructor(readonly appliedThrough: number) {
    super(`This operation's number is already used; applied through ${String(appliedThrough)}`);
    this.name = "SequenceStaleError";
  }
}

const REFUSAL: Readonly<Record<SequenceVerdictKind, ((appliedThrough: number) => Error) | undefined>> = {
  next: undefined,
  repeat: undefined,
  rerun: undefined,
  stale: (appliedThrough) => new SequenceStaleError(appliedThrough),
  gap: (appliedThrough) => new SequenceGapError(appliedThrough),
};

/**
 * One operation's turn: `decide` gives its verdict once the identity can be looked up, throwing for
 * `stale` and `gap`; `accept` records the operation as applied and returns where the device's
 * cursor stands.
 */
export interface SequenceTurn {
  decide(identity: () => IdentityStanding): SequenceVerdictKind;
  accept(): number;
}

export interface SequenceCursors {
  /** The turn of one numbered operation; throws `SequenceGapError` at once when an earlier one is missing. */
  turn(sessionId: string, operation: SequencedOperation): SequenceTurn;
  /** The highest number applied for this device on this session. */
  appliedThrough(sessionId: string, deviceId: string): number;
}

interface CursorEntry {
  readonly seq: number;
  readonly usedAt: number;
}

type CursorTable = Record<string, Record<string, CursorEntry>>;

/** A tab is a device, so the table gains a row per tab that ever sent; rows unused this long are dropped. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function createSequenceCursors(dataDir: string | undefined, now: () => number = Date.now): SequenceCursors {
  const filePath = dataDir === undefined ? undefined : join(dataDir, "sequence-cursors.json");
  const table: CursorTable = pruned(filePath === undefined ? {} : readTable(filePath), now());
  const cursorOf = (sessionId: string, deviceId: string): number => table[sessionId]?.[deviceId]?.seq ?? 0;
  const record = (sessionId: string, deviceId: string, seq: number): void => {
    table[sessionId] = { ...table[sessionId], [deviceId]: { seq, usedAt: now() } };
    if (filePath !== undefined) writeTable(filePath, table);
  };
  return {
    turn(sessionId, operation) {
      const applied = Math.max(cursorOf(sessionId, operation.deviceId), operation.ackedThrough);
      const place = placeOf(applied, operation.seq);
      if (place === "past") throw new SequenceGapError(applied);
      return {
        decide(identity) {
          const verdict = sequenceVerdict(applied, operation.seq, identity);
          const refusal = REFUSAL[verdict];
          if (refusal !== undefined) throw refusal(applied);
          return verdict;
        },
        accept() {
          const through = Math.max(applied, operation.seq);
          record(sessionId, operation.deviceId, through);
          return through;
        },
      };
    },
    appliedThrough(sessionId, deviceId) {
      return cursorOf(sessionId, deviceId);
    },
  };
}

function pruned(table: CursorTable, now: number): CursorTable {
  const kept: CursorTable = {};
  for (const [sessionId, devices] of Object.entries(table)) {
    const live = Object.entries(devices).filter(([, entry]) => now - entry.usedAt < RETENTION_MS);
    if (live.length > 0) kept[sessionId] = Object.fromEntries(live);
  }
  return kept;
}

function readTable(filePath: string): CursorTable {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return isCursorTable(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isCursorEntry(value: unknown): value is CursorEntry {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "seq") === "number" && typeof Reflect.get(value, "usedAt") === "number";
}

function isCursorTable(value: unknown): value is CursorTable {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((devices: unknown) => typeof devices === "object" && devices !== null && Object.values(devices).every(isCursorEntry));
}

function writeTable(filePath: string, table: CursorTable): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.writing`;
  writeFileSync(temporary, JSON.stringify(table), "utf8");
  renameSync(temporary, filePath);
}
