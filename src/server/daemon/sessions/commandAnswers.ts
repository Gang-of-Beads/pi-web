import type { ClientCommandResult } from "../../shared/types.js";

/**
 * A device's command answers kept by identity (docs/design/message-states.md, "Order"), so a
 * device that resends a command whose answer it lost gets what the command answered the first
 * time and the command runs once. A resend that arrives while the command still runs waits for
 * the same run.
 *
 * Held in memory, newest kept: after a restart the ledger still knows the command ran, and its
 * resend is answered as done without what it said.
 */
export interface CommandAnswers {
  remember(sessionId: string, clientMessageId: string, run: Promise<ClientCommandResult>): void;
  repeat(sessionId: string, clientMessageId: string): Promise<ClientCommandResult>;
}

const KEPT = 256;
const RAN_BEFORE: ClientCommandResult = { type: "done" };

export function createCommandAnswers(kept = KEPT): CommandAnswers {
  const answers = new Map<string, Promise<ClientCommandResult>>();
  const keyOf = (sessionId: string, clientMessageId: string): string => `${sessionId}\u0000${clientMessageId}`;
  return {
    remember(sessionId, clientMessageId, run) {
      answers.set(keyOf(sessionId, clientMessageId), run);
      run.catch(() => undefined);
      const oldest = answers.keys().next();
      if (answers.size > kept && oldest.done !== true) answers.delete(oldest.value);
    },
    repeat(sessionId, clientMessageId) {
      return answers.get(keyOf(sessionId, clientMessageId)) ?? Promise.resolve(RAN_BEFORE);
    },
  };
}
