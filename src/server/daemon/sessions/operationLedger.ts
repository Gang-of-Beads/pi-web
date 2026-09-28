import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_LEDGER_LIMITS, afterRestart, decideOperation,
  type LedgerLimits, type OperationDecision, type OperationOutcome, type OperationRow,
} from "./operationDecision.js";

/**
 * Where operation rows live across a daemon restart.
 *
 * The ledger this replaces said so itself: "Process-scoped and bounded. A
 * daemon restart forgets the ledger." Forgetting turns the browser's retry -
 * which is correct behaviour, because its answer was lost - into a second run
 * of the same prompt. Rows are appended as one JSON object per line, which
 * survives a kill mid-write: a truncated tail is dropped on load rather than
 * poisoning the file.
 *
 * The store owns durability and nothing else. Every judgement is made by the
 * pure classifier in `operationDecision.ts`, so the rules can be enumerated in
 * tests without a filesystem.
 */
interface StoredRow extends OperationRow {
  readonly sessionId: string;
}

export class OperationLedger {
  private readonly rows = new Map<string, Map<string, OperationRow>>();

  private constructor(
    private readonly filePath: string,
    private readonly limits: LedgerLimits,
    loaded: StoredRow[],
  ) {
    const now = Date.now();
    for (const row of loaded) {
      if (now - row.updatedAt > limits.retentionMs) continue;
      this.put(row.sessionId, afterRestart(row));
    }
  }

  /**
   * Load the ledger, downgrading anything still pending to `unknown`: the
   * process that could have settled those rows is gone, and claiming either
   * outcome would be a guess about work that may have run.
   */
  static open(dataDir: string, limits: LedgerLimits = DEFAULT_LEDGER_LIMITS): OperationLedger {
    const filePath = join(dataDir, "operations.jsonl");
    const loaded = readRows(filePath);
    const ledger = new OperationLedger(filePath, limits, loaded);
    ledger.compact();
    return ledger;
  }

  decide(sessionId: string, operationId: string, fingerprint: string, now: number = Date.now()): OperationDecision {
    const existing = this.rows.get(sessionId)?.get(operationId);
    const count = this.rows.get(sessionId)?.size ?? 0;
    return decideOperation(existing, { operationId, fingerprint, now }, count, this.limits);
  }

  /** Record an admitted operation as running. */
  begin(sessionId: string, operationId: string, fingerprint: string, now: number = Date.now()): void {
    this.write({ sessionId, operationId, fingerprint, outcome: "pending", recordedAt: now, updatedAt: now });
  }

  /** Record how an operation ended. Only the process that ran it may say this. */
  settle(sessionId: string, operationId: string, outcome: Exclude<OperationOutcome, "pending">, now: number = Date.now()): void {
    const existing = this.rows.get(sessionId)?.get(operationId);
    if (existing === undefined) return;
    this.write({ ...existing, sessionId, outcome, updatedAt: now });
  }

  rowFor(sessionId: string, operationId: string): OperationRow | undefined {
    return this.rows.get(sessionId)?.get(operationId);
  }

  /** Rows a reconnecting client can use to close its open operations. */
  openRows(sessionId: string): OperationRow[] {
    return [...(this.rows.get(sessionId)?.values() ?? [])].filter((row) => row.outcome === "pending" || row.outcome === "unknown");
  }

  private put(sessionId: string, row: OperationRow): void {
    const bySession = this.rows.get(sessionId) ?? new Map<string, OperationRow>();
    bySession.set(row.operationId, row);
    this.rows.set(sessionId, bySession);
  }

  private write(row: StoredRow): void {
    this.put(row.sessionId, row);
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(row)}\n`, "utf8");
  }

  /** Rewrite the file from what is held, so replayed history cannot grow without bound. */
  private compact(): void {
    const lines: string[] = [];
    for (const [sessionId, bySession] of this.rows) {
      for (const row of bySession.values()) lines.push(JSON.stringify({ ...row, sessionId }));
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.rewriting`;
    writeFileSync(temporary, lines.length === 0 ? "" : `${lines.join("\n")}\n`, "utf8");
    renameSync(temporary, this.filePath);
  }
}

function readRows(filePath: string): StoredRow[] {
  let raw: string;
  try { raw = readFileSync(filePath, "utf8"); }
  catch { return []; }
  const rows: StoredRow[] = [];
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    let parsed: unknown;
    // A daemon killed mid-append leaves a partial last line. Dropping it is the
    // whole reason for one row per line.
    try { parsed = JSON.parse(line); } catch { continue; }
    if (isStoredRow(parsed)) rows.push(parsed);
  }
  return rows;
}

function isStoredRow(value: unknown): value is StoredRow {
  if (typeof value !== "object" || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return typeof record["sessionId"] === "string"
    && typeof record["operationId"] === "string"
    && typeof record["fingerprint"] === "string"
    && typeof record["recordedAt"] === "number"
    && typeof record["updatedAt"] === "number"
    && isOutcome(record["outcome"]);
}

function isOutcome(value: unknown): value is OperationOutcome {
  return value === "pending" || value === "succeeded" || value === "failed" || value === "withdrawn" || value === "unknown";
}

/**
 * The session service's view of accepted prompts, by sender identity.
 *
 * A row is written when a prompt is accepted and moves forward only: pending until the agent
 * consumes it, then succeeded; failed when the runtime refuses it for good; withdrawn when the
 * reader takes it back. Nothing deletes a row - stopping a session, recalling a message or a
 * refused handoff used to, and each deletion turned an outbox retry of that identity into a
 * second run. Rows leave only by age, past the retention window.
 */
export type SettledOutcome = "succeeded" | "failed" | "withdrawn";

export interface AcceptanceFace {
  /** Whether a request carrying this identity repeats one already accepted, so must not run again. */
  has(sessionId: string, clientMessageId: string): boolean;
  /** Record an acceptance. Only a row whose earlier attempt failed is admitted again. */
  record(sessionId: string, clientMessageId: string): void;
  settle(sessionId: string, clientMessageId: string, outcome: SettledOutcome): void;
  /**
   * What the daemon can say about identities a client could not settle. An
   * identity it has never seen is absent from the answer rather than reported
   * as anything: "we have no row" and "it failed" are different facts.
   */
  outcomesFor(sessionId: string, operationIds: readonly string[]): Record<string, OperationOutcome>;
}

/**
 * Which recorded outcomes let the same identity run again.
 *
 * `unknown` does: a row is settled `succeeded` synchronously in the event where the agent reads
 * the message, so a row a restart found still pending is one the agent never read. Its message
 * was in the runtime's memory and died with it; answering the sender's retry as a duplicate
 * would lose it for good. A message the restart did preserve - still in the inbox - is recorded
 * again when the inbox is restored, so its retry stays a duplicate.
 */
export const READMITTED: Record<OperationOutcome, boolean> = {
  pending: false,
  succeeded: false,
  withdrawn: false,
  failed: true,
  unknown: true,
};

/** Which recorded outcomes a later fact may still settle. A settled row never moves back. */
export const SETTLEABLE: Record<OperationOutcome, boolean> = {
  pending: true,
  unknown: true,
  succeeded: false,
  failed: false,
  withdrawn: false,
};

export function createDurableAcceptanceLedger(dataDir: string): AcceptanceFace {
  const ledger = OperationLedger.open(dataDir);
  return {
    has(sessionId, clientMessageId) {
      const existing = ledger.rowFor(sessionId, clientMessageId);
      return existing !== undefined && !READMITTED[existing.outcome];
    },
    record(sessionId, clientMessageId) {
      const existing = ledger.rowFor(sessionId, clientMessageId);
      if (existing !== undefined && !READMITTED[existing.outcome]) return;
      if (existing === undefined) {
        const decision = ledger.decide(sessionId, clientMessageId, "prompt");
        if (decision.kind !== "admit") {
          console.warn(`[operationLedger] acceptance of ${clientMessageId} in ${sessionId} not recorded: ${decision.kind === "refuse" ? decision.code : decision.kind}`);
          return;
        }
      }
      ledger.begin(sessionId, clientMessageId, "prompt");
    },
    settle(sessionId, clientMessageId, outcome) {
      const existing = ledger.rowFor(sessionId, clientMessageId);
      if (existing === undefined || !SETTLEABLE[existing.outcome]) return;
      ledger.settle(sessionId, clientMessageId, outcome);
    },
    outcomesFor(sessionId, operationIds) {
      const answer: Record<string, OperationOutcome> = {};
      for (const operationId of operationIds) {
        const row = ledger.rowFor(sessionId, operationId);
        if (row !== undefined) answer[operationId] = row.outcome;
      }
      return answer;
    },
  };
}
