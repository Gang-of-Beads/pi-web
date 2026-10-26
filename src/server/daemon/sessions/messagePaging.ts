import { getString } from "../../../shared/unknownValues.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function pageMessagesAtSafeBoundary<T>(messages: T[], page?: { before?: number; limit?: number }) {
  const total = messages.length;
  if (page?.before === undefined && page?.limit === undefined) return { messages, start: 0, total };
  const before = clampInteger(page.before ?? total, 0, total);
  const limit = clampInteger(page.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const requestedStart = Math.max(0, before - limit);
  const start = page.before === undefined ? expandStartToSafeBoundary(messages, requestedStart) : startWithinReach(messages, requestedStart);
  return { messages: messages.slice(start, before), start, total };
}

export function expandStartToSafeBoundary(messages: unknown[], requestedStart: number): number {
  const start = clampInteger(requestedStart, 0, messages.length);
  if (start === 0 || isTurnBoundary(messages[start])) return start;
  for (let index = start - 1; index >= 0; index -= 1) {
    if (isTurnBoundary(messages[index])) return index;
  }
  return 0;
}

/**
 * How far back a page read with `before` reaches for the user message that opens its turn.
 *
 * It used to reach however far back that was. Inside an agent turn of a few hundred tool calls, an
 * earlier page reaching into the turn was the rest of the turn, and one of 460 rows pushed the
 * reader's own rows off the browser's 400-row span: the reader was thrown (754 -> 294 on a real
 * session; r162, 2026-10-29). The newest page, read without `before`, still reaches the whole way:
 * the browser's newer read asks for it, and a smaller one would leave a gap under a window that ends
 * inside the final turn, which replaces the window and throws the reader (review 368bf929).
 */
const TURN_REACH = DEFAULT_LIMIT;

/**
 * Where a page read with `before` starts: at the user message that opens its turn when that is within
 * `TURN_REACH`; otherwise at the nearest message within that reach that is not a tool result;
 * otherwise where it was asked to. Such a page is at most its limit plus one reach, and it opens on a
 * tool result only when a run of results longer than the reach straddles its start.
 */
function startWithinReach(messages: unknown[], requestedStart: number): number {
  const start = clampInteger(requestedStart, 0, messages.length);
  const floor = Math.max(0, start - TURN_REACH);
  for (let index = start; index >= floor; index -= 1) {
    if (isTurnBoundary(messages[index])) return index;
  }
  for (let index = start; index >= floor; index -= 1) {
    if (!isToolResult(messages[index])) return index;
  }
  return start;
}

function isTurnBoundary(message: unknown): boolean {
  return getString(message, "role") === "user";
}

function isToolResult(message: unknown): boolean {
  return getString(message, "role") === "toolResult";
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
