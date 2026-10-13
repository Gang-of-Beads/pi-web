import { HttpError } from "./api/http.js";

/**
 * Which answers end a message for good (docs/design/message-states.md, "Which answers end it").
 *
 * Only an answer that says the request can never succeed - the request is invalid (400), the
 * session is gone (404), the message is too large (413) - cancels it; its words go back to the
 * composer. Anything else is not an answer: no reply, a timeout, a gateway's 5xx, 409 (busy, or
 * an operation ahead of an earlier one that has not arrived), 429. The message stays "Sending…"
 * and is sent again under its identity and number until the machine answers.
 */
const REFUSED_FOR_GOOD: Readonly<Record<number, true>> = { 400: true, 404: true, 413: true };

export function sendRefusedForGood(error: unknown): boolean {
  return error instanceof HttpError && REFUSED_FOR_GOOD[error.status] === true;
}
