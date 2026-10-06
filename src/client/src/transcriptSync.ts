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

/** What happened to the page's hold on the transcript. */
export type TranscriptSyncEvent =
  | { readonly type: "doubt"; readonly key: string }
  | { readonly type: "checked"; readonly key: string; readonly at: number }
  | { readonly type: "checkFailed"; readonly key: string };

type Transition = (current: TranscriptSync | undefined, event: TranscriptSyncEvent) => TranscriptSync | undefined;

const TRANSITIONS: Readonly<Record<TranscriptSyncEvent["type"], Transition>> = {
  doubt: (current, event) => ({ kind: "confirming", key: event.key, ...lastConfirmed(current, event.key) }),
  checked: (_current, event) => event.type === "checked" ? { kind: "confirmed", key: event.key, at: event.at } : undefined,
  checkFailed: (current, event) => current?.key === event.key ? { kind: "unreachable", key: event.key, ...lastConfirmed(current, event.key) } : current,
};

/** The next state. A check that lands for another key than the one doubted is not this page's answer. */
export function nextTranscriptSync(current: TranscriptSync | undefined, event: TranscriptSyncEvent): TranscriptSync | undefined {
  if (event.type !== "doubt" && current !== undefined && current.key !== event.key) return current;
  return TRANSITIONS[event.type](current, event);
}

function lastConfirmed(current: TranscriptSync | undefined, key: string): { lastConfirmedAt?: number } {
  if (current?.key !== key) return {};
  const at = current.kind === "confirmed" ? current.at : current.lastConfirmedAt;
  return at === undefined ? {} : { lastConfirmedAt: at };
}

/** What the dock says instead of the session's status, or undefined when the status can be trusted. */
export type TranscriptSyncDock = { readonly kind: "syncing"; readonly words: string } | { readonly kind: "offline"; readonly words: string };

const DOCK: Readonly<Record<TranscriptSync["kind"], (sync: TranscriptSync, clock: (at: number) => string) => TranscriptSyncDock | undefined>> = {
  confirmed: () => undefined,
  confirming: () => ({ kind: "syncing", words: "Syncing…" }),
  unreachable: (sync, clock) => {
    const at = sync.kind === "unreachable" ? sync.lastConfirmedAt : undefined;
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
