/**
 * Whether the selected session's transcript on this page is in step with the daemon's
 * (docs/design/sync-convergence.md, "Phase B for the transcript").
 *
 * Owner, 2026-10-06: a phone showed "idle" under his own message while the reply sat on disk. The
 * page had been in the background; its status was current and its transcript was not, and nothing
 * said so. Then, the same day, on how to say it: "Syncing…" only when the page knows it is out of
 * step - frames it knows are missing, or a check that could not confirm - never for a routine
 * check, or a slow network would show it on every turn; and never "offline", a warning the reader
 * cannot act on, since the page keeps trying. Every value carries the machine + session key it is
 * about, and is read only for that key.
 */
export type TranscriptSync =
  | { readonly kind: "confirmed"; readonly key: string }
  | { readonly kind: "checking"; readonly key: string }
  | { readonly kind: "behind"; readonly key: string }
  | { readonly kind: "retrying"; readonly key: string };

/**
 * `check`: a routine reason to look (opened, back in front, online again, a connection lost or
 * reopened, a turn ended). `missing`: the page knows frames are missing (a seq gap, a heartbeat
 * ahead, a frame it could not read, another seq space). `checked` / `checkFailed`: the answer.
 */
export interface TranscriptSyncEvent {
  readonly type: "check" | "missing" | "checked" | "checkFailed";
  readonly key: string;
}

type Kind = TranscriptSync["kind"];

/** The next kind for the same key; a key not seen yet starts from `confirmed`'s row. */
const TRANSITIONS: Readonly<Record<Kind, Readonly<Record<TranscriptSyncEvent["type"], Kind>>>> = {
  confirmed: { check: "checking", missing: "behind", checked: "confirmed", checkFailed: "retrying" },
  checking: { check: "checking", missing: "behind", checked: "confirmed", checkFailed: "retrying" },
  behind: { check: "behind", missing: "behind", checked: "confirmed", checkFailed: "retrying" },
  retrying: { check: "retrying", missing: "retrying", checked: "confirmed", checkFailed: "retrying" },
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
  behind: "keep",
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

/** What the dock says instead of the session's status. */
export interface TranscriptSyncDock {
  readonly words: string;
}

const SYNCING: TranscriptSyncDock = { words: "Syncing…" };

const DOCK: Readonly<Record<Kind, TranscriptSyncDock | undefined>> = {
  confirmed: undefined,
  checking: undefined,
  behind: SYNCING,
  retrying: SYNCING,
};

/** The dock's words for `key`, or undefined when the session's status can be shown; another key's value says nothing here. */
export function transcriptSyncDock(sync: TranscriptSync | undefined, key: string | undefined): TranscriptSyncDock | undefined {
  if (sync === undefined || key === undefined || sync.key !== key) return undefined;
  return DOCK[sync.kind];
}
