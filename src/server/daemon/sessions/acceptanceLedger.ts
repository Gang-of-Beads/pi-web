import type { OperationOutcome } from "./operationDecision.js";
import { READMITTED, SETTLEABLE, type AcceptanceFace } from "./operationLedger.js";

/**
 * The same acceptance rules as the durable ledger, held in memory: for a daemon started
 * without a data directory, and for tests. Rows move forward only and are never deleted
 * (see createDurableAcceptanceLedger), so a retry is answered the same way by either.
 */
export function createInMemoryAcceptanceLedger(): AcceptanceFace {
  const rows = new Map<string, Map<string, OperationOutcome>>();
  const bySession = (sessionId: string): Map<string, OperationOutcome> => {
    const existing = rows.get(sessionId);
    if (existing !== undefined) return existing;
    const created = new Map<string, OperationOutcome>();
    rows.set(sessionId, created);
    return created;
  };
  return {
    has(sessionId, clientMessageId) {
      const existing = rows.get(sessionId)?.get(clientMessageId);
      return existing !== undefined && !READMITTED[existing];
    },
    record(sessionId, clientMessageId) {
      const session = bySession(sessionId);
      const existing = session.get(clientMessageId);
      if (existing !== undefined && !READMITTED[existing]) return;
      session.set(clientMessageId, "pending");
    },
    settle(sessionId, clientMessageId, outcome) {
      const session = rows.get(sessionId);
      const existing = session?.get(clientMessageId);
      if (session === undefined || existing === undefined || !SETTLEABLE[existing]) return;
      session.set(clientMessageId, outcome);
    },
    outcomesFor(sessionId, operationIds) {
      const answer: Record<string, OperationOutcome> = {};
      const session = rows.get(sessionId);
      for (const operationId of operationIds) {
        const outcome = session?.get(operationId);
        if (outcome !== undefined) answer[operationId] = outcome;
      }
      return answer;
    },
  };
}
