import type { ServerFactMap } from "../../../server-plugin-api.js";
import { isRecord } from "../../../shared/unknownValues.js";

export type RunEnding = Pick<ServerFactMap["run.ended"], "outcome" | "error">;

/** How the run's last reply ended, as its `agent_end` carries it; a later attempt of the same run replaces it. */
export interface RunLastReply {
  readonly stopReason?: string;
  readonly errorMessage?: string;
}

export function runLastReply(agentEnd: unknown): RunLastReply | undefined {
  const messages = isRecord(agentEnd) ? agentEnd["messages"] : undefined;
  if (!Array.isArray(messages)) return undefined;
  const reply: unknown = messages.filter((message: unknown) => isRecord(message) && message["role"] === "assistant").at(-1);
  if (!isRecord(reply)) return undefined;
  const stopReason = reply["stopReason"];
  const errorMessage = reply["errorMessage"];
  return {
    ...(typeof stopReason === "string" ? { stopReason } : {}),
    ...(typeof errorMessage === "string" && errorMessage !== "" ? { errorMessage } : {}),
  };
}

/**
 * How an aborted run ended, in the words the transcript uses (owner, 2026-09-30: you stopped it, or
 * it was interrupted): `stopped` when the reader's Stop or `/new` cut it, `interrupted` for any other
 * abort, such as its session closing under it.
 */
export function cutRunEnding(stoppedByReader: boolean): RunEnding {
  return { outcome: stoppedByReader ? "stopped" : "interrupted" };
}

/**
 * How a settled run ended, for the `run.ended` fact: cut when it was aborted (cutRunEnding),
 * `failed` when its last reply ended on an error pi did not retry, otherwise `completed`.
 */
export function settledRunEnding(aborted: boolean, lastReply: RunLastReply | undefined, stoppedByReader: boolean): RunEnding {
  if (stoppedByReader || aborted || lastReply?.stopReason === "aborted") return cutRunEnding(stoppedByReader);
  if (lastReply?.stopReason === "error") return { outcome: "failed", ...(lastReply.errorMessage === undefined ? {} : { error: lastReply.errorMessage }) };
  return { outcome: "completed" };
}
