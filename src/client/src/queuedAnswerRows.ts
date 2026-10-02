import type { AskUserOutcome } from "../../shared/apiTypes";
import type { ChatLine } from "./components/shared";

/**
 * The reader's pending rows with the answers the agent has not read yet
 * among them (B26, state-diagram D2 "An answer is a message").
 *
 * An answer used to vanish with its card and reappear only once the agent
 * read it, 23 s later in the audit (`ask_user` beside a 25 s `bash`). It is
 * now its answers record marked Queued, placed by the time it was given:
 * before the first pending message known to be sent later, otherwise last.
 * An answer the transcript already holds is drawn there instead, so the
 * commit replaces the queued row rather than following it. A row from the
 * server queue (another device) carries no time, so an answer goes after it;
 * exact order would need the queue position on the status (review of 4a1bdfd7).
 */
export function withQueuedAnswers(pending: readonly ChatLine[], answers: readonly AskUserOutcome[] | undefined, transcript: readonly ChatLine[]): ChatLine[] {
  const rows = [...pending];
  for (const outcome of answers ?? []) {
    if (transcript.some((line) => recordsAnswer(line, outcome.askId))) continue;
    const answeredAt = Date.parse(outcome.closedAt);
    const later = rows.findIndex((line) => Date.parse(line.meta?.timestamp ?? "") > answeredAt);
    rows.splice(later === -1 ? rows.length : later, 0, queuedAnswerLine(outcome));
  }
  return rows;
}

/** Whether the row is an answer still waiting for the agent. */
export function isQueuedAnswer(line: ChatLine): boolean {
  return line.meta?.queuedAnswer === true;
}

function queuedAnswerLine(outcome: AskUserOutcome): ChatLine {
  return { role: "system", parts: [{ type: "askUserRecord", outcome }], meta: { timestamp: outcome.closedAt, queuedAnswer: true } };
}

function recordsAnswer(line: ChatLine, askId: string): boolean {
  return line.parts.some((part) => part.type === "askUserRecord" && part.outcome.askId === askId);
}
