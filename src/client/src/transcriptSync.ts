/**
 * Whether the selected session's transcript on this page is in step with the daemon's
 * (docs/design/sync-convergence.md, "Phase B for the transcript").
 *
 * Owner, 2026-10-06: a phone showed "idle" under his own message while the reply sat on disk. The
 * page had been in the background; its status was current and its transcript was not, and nothing
 * said so. Until the page has checked, it says it is syncing; when the check fails, it says when
 * it was last in step. Every value carries the machine + session key it is about, and is read only
 * for that key.
 */
export type TranscriptSync =
  | { readonly kind: "confirmed"; readonly key: string; readonly at: number }
  | { readonly kind: "confirming"; readonly key: string; readonly lastConfirmedAt?: number }
  | { readonly kind: "unreachable"; readonly key: string; readonly lastConfirmedAt?: number };

interface TranscriptSyncEvents {
  readonly doubt: { readonly key: string };
  readonly checked: { readonly key: string; readonly at: number };
  readonly checkFailed: { readonly key: string };
}

type TranscriptSyncEventType = keyof TranscriptSyncEvents;

/** What happened to the page's hold on the transcript. */
export type TranscriptSyncEvent<T extends TranscriptSyncEventType = TranscriptSyncEventType> = { [K in T]: { readonly type: K } & TranscriptSyncEvents[K] }[T];

const TRANSITIONS: { readonly [K in TranscriptSyncEventType]: (current: TranscriptSync | undefined, event: TranscriptSyncEvent<K>) => TranscriptSync } = {
  doubt: (current, event) => ({ kind: "confirming", key: event.key, ...lastConfirmed(current, event.key) }),
  checked: (_current, event) => ({ kind: "confirmed", key: event.key, at: event.at }),
  checkFailed: (current, event) => ({ kind: "unreachable", key: event.key, ...lastConfirmed(current, event.key) }),
};

/** The next state. A check that lands for another key than the one doubted is not this page's answer. */
export function nextTranscriptSync<T extends TranscriptSyncEventType>(current: TranscriptSync | undefined, event: TranscriptSyncEvent<T>): TranscriptSync | undefined {
  if (event.type !== "doubt" && current !== undefined && current.key !== event.key) return current;
  return TRANSITIONS[event.type](current, event);
}

function lastConfirmed(current: TranscriptSync | undefined, key: string): { lastConfirmedAt?: number } {
  if (current?.key !== key) return {};
  const at = lastConfirmedAt(current);
  return at === undefined ? {} : { lastConfirmedAt: at };
}

function lastConfirmedAt(sync: TranscriptSync): number | undefined {
  return sync.kind === "confirmed" ? sync.at : sync.lastConfirmedAt;
}

/** What the retry of an unreachable transcript does after a transition (owner: keep retrying). */
export type TranscriptRetryAction = "arm" | "keep" | "cancel";

const RETRY_ACTION: Readonly<Record<TranscriptSync["kind"], TranscriptRetryAction>> = {
  confirmed: "cancel",
  confirming: "keep",
  unreachable: "arm",
};

/**
 * Whether to arm, keep or cancel the retry armed for `armedKey`. A check a retry started keeps the
 * backoff it grew; the same state for another key starts over, so one session's outage does not
 * lengthen the next one's first retry.
 */
export function transcriptRetryAction(next: TranscriptSync | undefined, armedKey: string | undefined): TranscriptRetryAction {
  if (next === undefined) return "cancel";
  const action = RETRY_ACTION[next.kind];
  return action === "keep" && armedKey !== next.key ? "cancel" : action;
}

/** What the dock says instead of the session's status, or undefined when the status can be trusted. */
export type TranscriptSyncDock = { readonly kind: "syncing"; readonly words: string } | { readonly kind: "offline"; readonly words: string };

const DOCK: Readonly<Record<TranscriptSync["kind"], (sync: TranscriptSync, clock: (at: number) => string) => TranscriptSyncDock | undefined>> = {
  confirmed: () => undefined,
  confirming: () => ({ kind: "syncing", words: "Syncing…" }),
  unreachable: (sync, clock) => {
    const at = lastConfirmedAt(sync);
    return { kind: "offline", words: at === undefined ? "Offline" : `Offline · updated ${clock(at)}` };
  },
};

/** The dock's words for `key`; a value about another session says nothing here. */
export function transcriptSyncDock(sync: TranscriptSync | undefined, key: string | undefined, clock: (at: number) => string = hourMinute): TranscriptSyncDock | undefined {
  if (sync === undefined || key === undefined || sync.key !== key) return undefined;
  return DOCK[sync.kind](sync, clock);
}

function hourMinute(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
