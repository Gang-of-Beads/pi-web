/**
 * Where the reader is going (D8 in docs/design/state-diagram.md).
 *
 * Owner, 2026-09-30: pages "jumped" with nothing pressed. A tap on a session closed
 * the list at once, uncovering the previous chat, and the destination arrived seconds
 * later and forced the chat view over whatever the reader had moved on to. The owner
 * chose to stay in place and make the tap visible ("staying in place is fine, but how does the user
 * perceive that they tapped this button?").
 *
 * Every navigation is an intent with a sequence number from this one counter. Only
 * the latest intent may move the page, so an answer that arrives after the reader has
 * gone elsewhere changes nothing. An intent with a target stays pending, shown on the
 * tapped item, until it settles or fails.
 */

export type NavigationPhase = "going" | "slow" | "stalled" | "failed";

/** Nielsen's limits: past 1 s the reader notices the wait, past 10 s they need a way out. */
export const SLOW_AFTER_MS = 1_000;
export const STALLED_AFTER_MS = 10_000;

export function navigationPhase(elapsedMs: number, failed: boolean): NavigationPhase {
  if (failed) return "failed";
  if (elapsedMs >= STALLED_AFTER_MS) return "stalled";
  if (elapsedMs >= SLOW_AFTER_MS) return "slow";
  return "going";
}

export interface NavigationTarget {
  readonly key: string;
  readonly label: string;
}

export interface PendingNavigation extends NavigationTarget {
  readonly phase: NavigationPhase;
}

export interface NavigationClock {
  now(): number;
  after(ms: number, run: () => void): () => void;
}

const browserClock: NavigationClock = {
  now: () => Date.now(),
  after: (ms, run) => {
    const id = globalThis.setTimeout(run, ms);
    return () => { globalThis.clearTimeout(id); };
  },
};

interface Pending extends NavigationTarget {
  readonly seq: number;
  readonly startedAt: number;
  readonly failed: boolean;
}

export class NavigationIntents {
  private seq = 0;
  private pending: Pending | undefined;
  private timers: (() => void)[] = [];

  constructor(private readonly onChange: () => void, private readonly clock: NavigationClock = browserClock) {}

  /** A reader intent. Without a target it only supersedes whatever was pending. */
  begin(target?: NavigationTarget): number {
    this.seq += 1;
    this.stopTimers();
    this.pending = target === undefined ? undefined : { ...target, seq: this.seq, startedAt: this.clock.now(), failed: false };
    if (target !== undefined) this.timers = [SLOW_AFTER_MS, STALLED_AFTER_MS].map((ms) => this.clock.after(ms, this.onChange));
    this.onChange();
    return this.seq;
  }

  latest(): number {
    return this.seq;
  }

  isCurrent(seq: number): boolean {
    return seq === this.seq;
  }

  /** The destination is on screen. */
  settle(seq: number): void {
    if (this.pending?.seq !== seq) return;
    this.pending = undefined;
    this.stopTimers();
    this.onChange();
  }

  /** The destination could not be read; the reader stays, and the item says so. */
  fail(seq: number): void {
    if (this.pending?.seq !== seq) return;
    this.pending = { ...this.pending, failed: true };
    this.stopTimers();
    this.onChange();
  }

  /** Back or Escape drops a pending open without moving. With nothing pending it retires nothing. */
  cancel(): void {
    if (this.pending !== undefined) this.begin();
  }

  view(): PendingNavigation | undefined {
    const pending = this.pending;
    if (pending === undefined) return undefined;
    return { key: pending.key, label: pending.label, phase: navigationPhase(this.clock.now() - pending.startedAt, pending.failed) };
  }

  /** A second tap on the item already opening does nothing; a failed one is tried again. */
  isOpening(key: string): boolean {
    return this.pending?.key === key && !this.pending.failed;
  }

  dispose(): void {
    this.stopTimers();
  }

  private stopTimers(): void {
    for (const stop of this.timers) stop();
    this.timers = [];
  }
}

/** What the one live announcement says, naming the target in every phase. */
export function openingAnnouncement(pending: PendingNavigation): string {
  return pending.phase === "failed" ? `Couldn't open ${pending.label}` : `Opening ${pending.label}`;
}

/** What an opening item says on its secondary line, by phase. */
export const OPENING_WORDS: Readonly<Record<NavigationPhase, string>> = {
  going: "",
  slow: "Opening…",
  stalled: "Still opening…",
  failed: "Couldn't open · retry",
};
