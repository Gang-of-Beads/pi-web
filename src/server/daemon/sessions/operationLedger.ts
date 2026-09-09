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
    for (const row of loaded) this.put(row.sessionId, afterRestart(row));
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

  forgetSession(sessionId: string, now: number = Date.now()): void {
    if (!this.rows.delete(sessionId)) return;
    this.write({ sessionId, operationId: `session-forgotten-${String(now)}`, fingerprint: "-", outcome: "failed", recordedAt: now, updatedAt: now }, false);
    this.compact();
  }

  private put(sessionId: string, row: OperationRow): void {
    const bySession = this.rows.get(sessionId) ?? new Map<string, OperationRow>();
    bySession.set(row.operationId, row);
    this.rows.set(sessionId, bySession);
  }

  private write(row: StoredRow, remember = true): void {
    if (remember) this.put(row.sessionId, row);
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
  return value === "pending" || value === "succeeded" || value === "failed" || value === "unknown";
}

/**
 * The acceptance face the session service already uses, backed by durable rows.
 *
 * Keeping the old four methods means the call sites do not change shape while
 * the durability underneath them does; the difference a user can feel is that
 * a retry after a daemon restart is now answered instead of run again.
 */
export interface AcceptanceFace {
  has(sessionId: string, clientMessageId: string): boolean;
  record(sessionId: string, clientMessageId: string): void;
  forget(sessionId: string, clientMessageId: string): void;
  forgetSession(sessionId: string): void;
}

export function createDurableAcceptanceLedger(dataDir: string): AcceptanceFace {
  const ledger = OperationLedger.open(dataDir);
  return {
    has(sessionId, clientMessageId) {
      const row = ledger.rowFor(sessionId, clientMessageId);
      return row !== undefined && row.outcome !== "failed";
    },
    record(sessionId, clientMessageId) {
      const decision = ledger.decide(sessionId, clientMessageId, "prompt");
      if (decision.kind === "admit") ledger.begin(sessionId, clientMessageId, "prompt");
      ledger.settle(sessionId, clientMessageId, "succeeded");
    },
    forget(sessionId, clientMessageId) {
      if (ledger.rowFor(sessionId, clientMessageId) === undefined) return;
      ledger.settle(sessionId, clientMessageId, "failed");
    },
    forgetSession(sessionId) {
      ledger.forgetSession(sessionId);
    },
  };
}
