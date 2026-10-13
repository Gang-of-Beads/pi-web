import type { PluginReadFailure } from "@gang-of-beads/pi-web/plugin-api";

/**
 * What the terminal panel does when a request to its machine fails (B48, owner 2026-10-13: "we keep
 * trying; never show the user an error they cannot fix; a surface is trying-to-sync, syncing or
 * normal").
 *
 * The panel used to put every failure in red, through the host's error words: "The server did not
 * answer within 30s." sat above the shells after a daemon restart, with nothing that would read
 * again. The host now says what a failure means (`ui.readFailure`); this decides what the panel does
 * about it, per request, because a write is not a read. The host's answer is one of three kinds here:
 * - `unanswered`: nothing answered (a deadline, a dropped link, a machine that did not answer);
 * - `answered-error`: a server answered with an error, in its own words;
 * - `refused`: a refusal the server stated (signed out, forbidden, gone).
 */
export type TerminalFailure = "unanswered" | "answered-error" | "refused";

export type TerminalOperation = "list" | "connect" | "start" | "close" | "rename" | "continue" | "cancel-run";

/**
 * - `retry-read`: keep what is known, say "Reconnecting…", read again after the host's delay.
 * - `reconcile`: read the shell list again to learn whether the write happened; never resend it.
 * - `retry-write`: an idempotent write: remember it, read again after the delay, and resend it while
 *   the list says it has not happened.
 * - `show-server-words`: what a server that answered said - a refusal or an error - which the reader
 *   can act on (another name, another try).
 */
export type TerminalRecovery = "retry-read" | "reconcile" | "retry-write" | "show-server-words";

/**
 * Reads follow the host's rule: only a stated refusal is shown. A start is never resent: a lost answer
 * may have started the shell, so the list decides. Close and rename are idempotent and are resent
 * until the list shows them done. A close or cancel the server turned down means the shell or run is
 * already gone or finished, which the list shows; nothing for the reader to act on.
 */
const RECOVERY: Readonly<Record<TerminalOperation, Readonly<Record<TerminalFailure, TerminalRecovery>>>> = {
  list: { unanswered: "retry-read", "answered-error": "retry-read", refused: "show-server-words" },
  connect: { unanswered: "retry-read", "answered-error": "retry-read", refused: "show-server-words" },
  start: { unanswered: "reconcile", "answered-error": "show-server-words", refused: "show-server-words" },
  close: { unanswered: "retry-write", "answered-error": "reconcile", refused: "reconcile" },
  rename: { unanswered: "retry-write", "answered-error": "show-server-words", refused: "show-server-words" },
  continue: { unanswered: "reconcile", "answered-error": "show-server-words", refused: "show-server-words" },
  "cancel-run": { unanswered: "reconcile", "answered-error": "reconcile", refused: "reconcile" },
};

function terminalFailureOf(failure: PluginReadFailure): TerminalFailure {
  if (failure.kind === "final") return "refused";
  return failure.reason === undefined ? "unanswered" : "answered-error";
}

export function terminalRecovery(operation: TerminalOperation, failure: PluginReadFailure): TerminalRecovery {
  return RECOVERY[operation][terminalFailureOf(failure)];
}

/** The server's own words for a failure that has them. */
export function terminalFailureWords(failure: PluginReadFailure): string | undefined {
  return failure.kind === "final" ? failure.words : failure.reason;
}

/** The quiet status while a read waits for an answer; the host's rows say the same. */
export const RECONNECTING_WORDS = "Reconnecting…";
