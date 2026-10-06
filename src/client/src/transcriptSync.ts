/**
 * Whether the selected session's transcript on this page is in step with the daemon's
 * (docs/design/sync-convergence.md, "Phase B for the transcript").
 *
 * Owner, 2026-10-06: a phone showed "idle" under his own message while the reply sat on disk. The
 * page checks quietly whenever it may have missed something and fetches only what it missed. What
 * the reader sees was settled the same day: the session's own line shows message and session state
 * (sending, working, idle); a link that does not answer is the top row's "Trying to sync with the
 * server…" (api/ackWatch.ts), managed apart. So this value is not drawn: it owns the checks and the
 * retry of a check that failed. Every value carries the machine + session key it is about.
 */
export type TranscriptSync =
  | { readonly kind: "confirmed"; readonly key: string }
  | { readonly kind: "checking"; readonly key: string }
  | { readonly kind: "retrying"; readonly key: string };

/**
 * `check`: a reason to look (opened, back in front, online again, a connection lost or reopened, a
 * turn ended, a gap seen). `checked` / `checkFailed`: the answer.
 */
export interface TranscriptSyncEvent {
  readonly type: "check" | "checked" | "checkFailed";
  readonly key: string;
}

type Kind = TranscriptSync["kind"];

/** The next kind for the same key; a key not seen yet starts from `confirmed`'s row. */
const TRANSITIONS: Readonly<Record<Kind, Readonly<Record<TranscriptSyncEvent["type"], Kind>>>> = {
  confirmed: { check: "checking", checked: "confirmed", checkFailed: "retrying" },
  checking: { check: "checking", checked: "confirmed", checkFailed: "retrying" },
  retrying: { check: "retrying", checked: "confirmed", checkFailed: "retrying" },
};

/** The next state. An answer that lands for another key than the one being checked is not this page's. */
export function nextTranscriptSync(current: TranscriptSync | undefined, event: TranscriptSyncEvent): TranscriptSync {
  const answer = event.type === "checked" || event.type === "checkFailed";
  if (answer && current !== undefined && current.key !== event.key) return current;
  const from: Kind = current?.key === event.key ? current.kind : "confirmed";
  const kind = TRANSITIONS[from][event.type];
  return current?.key === event.key && current.kind === kind ? current : { kind, key: event.key };
}

/** What the retry of a check that failed does after a transition (owner: keep trying). */
export type TranscriptRetryAction = "arm" | "keep" | "cancel";

const RETRY_ACTION: Readonly<Record<Kind, TranscriptRetryAction>> = {
  confirmed: "cancel",
  checking: "keep",
  retrying: "arm",
};

/**
 * Whether to arm, keep or cancel the retry armed for `armedKey`. A check a retry started keeps the
 * backoff it grew; another key's state starts over, so one session's outage does not lengthen the
 * next one's first retry.
 */
export function transcriptRetryAction(next: TranscriptSync, armedKey: string | undefined): TranscriptRetryAction {
  const action = RETRY_ACTION[next.kind];
  return action === "keep" && armedKey !== next.key ? "cancel" : action;
}
