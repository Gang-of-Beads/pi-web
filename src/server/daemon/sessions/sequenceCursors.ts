/**
 * Where each device's operation log stands on this machine (docs/design/message-states.md,
 * "Order").
 *
 * A device numbers every operation it sends to one session - a message, a take-back - 1, 2, 3,
 * and resends what is not answered, in order. The machine keeps, per session and device, the
 * highest number it has applied, so an operation that arrives ahead of an earlier one that has
 * not arrived is refused instead of run out of order: the reader's second message could never
 * be queued while the first was still on the wire, which is how a later message read "Queued"
 * above an earlier one that read "Not received".
 *
 * The device sends only the head of its outbox, so each request says everything before it is done
 * (`ackedThrough`); the cursor is the higher of that and what is on file, so a lost file costs
 * nothing but the gap check for one operation.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * `next`: the operation after the last one applied, so it runs. `repeat`: one applied before; it
 * is let through to the identity check, which answers it from the ledger and runs nothing twice.
 * `gap`: an earlier one has not arrived, so it is refused. `appliedThrough` is where the cursor
 * stands once the verdict is applied.
 */
export type SequenceVerdictKind = "next" | "repeat" | "gap";

export interface SequenceVerdict {
  readonly kind: SequenceVerdictKind;
  readonly appliedThrough: number;
}

/** Which verdicts refuse the operation. */
const REFUSES: Readonly<Record<SequenceVerdictKind, boolean>> = { next: false, repeat: false, gap: true };

export interface SequencedOperation {
  readonly deviceId: string;
  readonly seq: number;
  readonly ackedThrough: number;
}

export function sequenceVerdict(cursor: number, operation: SequencedOperation): SequenceVerdict {
  const applied = Math.max(cursor, operation.ackedThrough);
  const kind = verdictKind(Math.sign(operation.seq - (applied + 1)));
  return { kind, appliedThrough: APPLIED_THROUGH[kind](operation.seq, applied) };
}

/** Where the cursor stands after each verdict: the operation's own number once it runs, else where it was. */
const APPLIED_THROUGH: Readonly<Record<SequenceVerdictKind, (seq: number, applied: number) => number>> = {
  next: (seq) => seq,
  repeat: (_seq, applied) => applied,
  gap: (_seq, applied) => applied,
};

/** The verdict by where the operation falls against the next number expected: before it, at it, past it. */
const KIND_BY_PLACE: Readonly<Record<string, SequenceVerdictKind>> = { "-1": "repeat", "0": "next", "1": "gap" };

function verdictKind(place: number): SequenceVerdictKind {
  return KIND_BY_PLACE[String(place)] ?? "gap";
}

export class SequenceGapError extends Error {
  constructor(readonly appliedThrough: number) {
    super(`An earlier operation from this device has not arrived; applied through ${String(appliedThrough)}`);
    this.name = "SequenceGapError";
  }
}

export interface SequenceCursors {
  /** Admit one operation in its turn; throws `SequenceGapError` when an earlier one is missing. */
  admit(sessionId: string, operation: SequencedOperation): void;
}

type CursorTable = Record<string, Record<string, number>>;

export function createSequenceCursors(dataDir: string | undefined): SequenceCursors {
  const filePath = dataDir === undefined ? undefined : join(dataDir, "sequence-cursors.json");
  const table: CursorTable = filePath === undefined ? {} : readTable(filePath);
  const cursorOf = (sessionId: string, deviceId: string): number => table[sessionId]?.[deviceId] ?? 0;
  return {
    admit(sessionId, operation) {
      const cursor = cursorOf(sessionId, operation.deviceId);
      const verdict = sequenceVerdict(cursor, operation);
      if (REFUSES[verdict.kind]) throw new SequenceGapError(verdict.appliedThrough);
      if (verdict.appliedThrough !== cursor) {
        table[sessionId] = { ...table[sessionId], [operation.deviceId]: verdict.appliedThrough };
        if (filePath !== undefined) writeTable(filePath, table);
      }
    },
  };
}

function readTable(filePath: string): CursorTable {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return isCursorTable(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isCursorTable(value: unknown): value is CursorTable {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((devices: unknown) => typeof devices === "object" && devices !== null && Object.values(devices).every((seq: unknown) => typeof seq === "number"));
}

function writeTable(filePath: string, table: CursorTable): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.writing`;
  writeFileSync(temporary, JSON.stringify(table), "utf8");
  renameSync(temporary, filePath);
}

/** A device's operation number as a request carries it; undefined when the request carries none or a malformed one, which the routes refuse. */
export function parseSequencedOperation(value: unknown): SequencedOperation | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const deviceId: unknown = Reflect.get(value, "deviceId");
  const seq: unknown = Reflect.get(value, "seq");
  const ackedThrough: unknown = Reflect.get(value, "ackedThrough");
  if (typeof deviceId !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/u.test(deviceId)) return undefined;
  if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(ackedThrough)) return undefined;
  if (typeof seq !== "number" || typeof ackedThrough !== "number" || seq < 1 || ackedThrough < 0) return undefined;
  return { deviceId, seq, ackedThrough };
}
