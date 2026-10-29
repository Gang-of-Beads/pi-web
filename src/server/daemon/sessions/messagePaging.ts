import { isRecord } from "../../../shared/unknownValues.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function pageMessagesAtSafeBoundary<T>(messages: T[], page?: { before?: number; limit?: number }) {
  const total = messages.length;
  if (page?.before === undefined && page?.limit === undefined) return { messages, start: 0, total };
  const before = clampInteger(page.before ?? total, 0, total);
  const limit = clampInteger(page.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const requestedStart = Math.max(0, before - limit);
  const start = expandStartToSafeBoundary(messages, requestedStart);
  return { messages: messages.slice(start, before), start, total };
}

/**
 * How far back a page reaches for the user message that opens its turn.
 *
 * A page used to reach for it however far back it was. Inside an agent turn of a few hundred tool
 * calls every page touching the turn was then the whole turn: an earlier page that size pushed the
 * reader's own rows off the client's capped span (the reader was thrown, 754 -> 294 on a real
 * session), each forward page re-sent the turn, and the newest page of a session mid-run was all of
 * it (r162, 2026-10-29).
 */
const TURN_REACH = DEFAULT_LIMIT;

/**
 * Where a page starts: at the user message that opens its turn when that is within `TURN_REACH`,
 * otherwise at the nearest step that is not a tool result, so a result never arrives without its call.
 * A page is then at most its limit plus one reach.
 */
export function expandStartToSafeBoundary(messages: unknown[], requestedStart: number): number {
  const start = clampInteger(requestedStart, 0, messages.length);
  if (start === 0 || isTurnBoundary(messages[start])) return start;
  for (let index = start - 1; index >= Math.max(0, start - TURN_REACH); index -= 1) {
    if (isTurnBoundary(messages[index])) return index;
  }
  for (let index = start; index > 0; index -= 1) {
    if (!isToolResult(messages[index])) return index;
  }
  return 0;
}

function isTurnBoundary(message: unknown): boolean {
  return getString(message, "role") === "user";
}

function isToolResult(message: unknown): boolean {
  return getString(message, "role") === "toolResult";
}

function getProperty(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined;
  return value[key];
}

function getString(value: unknown, key: string): string | undefined {
  const property = getProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
