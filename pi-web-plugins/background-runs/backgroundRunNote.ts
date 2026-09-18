/**
 * The activity note for this session's own background work.
 *
 * "idle" is about the assistant's turn: saying it while subagents or bash
 * tasks this chat started are still running reads as "nothing is happening"
 * when something is. The count belongs to the session's status frame, but the
 * word for it belongs here - the shell should not learn a domain it does not
 * own.
 */
export function backgroundRunNote(count: unknown, idle: boolean): string | undefined {
  if (!idle) return undefined;
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return undefined;
  return count === 1 ? "1 background run" : `${String(count)} background runs`;
}

export function backgroundRunCountOf(status: unknown): unknown {
  if (typeof status !== "object" || status === null) return undefined;
  return Reflect.get(status, "backgroundRunCount");
}
