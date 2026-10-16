/**
 * When opening a session is over (owner, 2026-10-14: the "Opening" wait ended first, and the
 * composer's model, thinking level and token counts arrived after it).
 *
 * A selection is open once each of its first reads has answered or failed: the transcript tail,
 * the status (model, thinking level, stats) and the thinking capabilities of its model. An answer
 * that is empty (no model, zero tokens, no levels) is an answer; a read on its way is not. An
 * archived session reads only its transcript; a session this browser has only just asked for reads
 * nothing, so nothing is opening.
 *
 * The wait belongs to one selection: machine, folder, session and the selection's sequence number.
 * A read that answers for a superseded selection settles nothing, so it can neither end a newer
 * selection's wait nor reopen one.
 */

export type SelectionRead = "transcript" | "status" | "thinkingLevels";

/** One read's state: on its way, or settled the way `settled()` names it. */
export type SelectionReadState = "pending" | "answered" | "failed";

export interface SelectionPlace {
  readonly machineId: string;
  readonly cwd: string;
  readonly sessionId: string;
}

export interface SelectionScope extends SelectionPlace {
  readonly selectionSeq: number;
}

function samePlace(left: SelectionPlace, right: SelectionPlace): boolean {
  return left.machineId === right.machineId && left.cwd === right.cwd && left.sessionId === right.sessionId;
}

function sameSelection(left: SelectionScope, right: SelectionScope): boolean {
  return left.selectionSeq === right.selectionSeq && samePlace(left, right);
}

interface OpeningSelection {
  readonly scope: SelectionScope;
  readonly reads: Map<SelectionRead, SelectionReadState>;
}

/**
 * The current selection's first reads, and who waits for them. `onOpeningChange` hears whether the
 * selection on screen is still opening after every change; a waiter is released once the selection
 * of its place is no longer opening, or the selection moved to another place.
 */
export class SelectionReadinessTracker {
  private current: OpeningSelection | undefined;
  private waiters: { place: SelectionPlace; release: () => void }[] = [];

  constructor(private readonly onOpeningChange: (opening: boolean) => void) {}

  begin(scope: SelectionScope, awaited: readonly SelectionRead[]): void {
    this.current = { scope, reads: new Map(awaited.map((read) => [read, "pending"])) };
    this.publish();
  }

  settle(scope: SelectionScope, read: SelectionRead, state: Exclude<SelectionReadState, "pending">): void {
    const current = this.current;
    if (current === undefined || !sameSelection(current.scope, scope) || !current.reads.has(read)) return;
    current.reads.set(read, state);
    this.publish();
  }

  /** Nothing is opening: the selection was abandoned, or the one selected has nothing to read. */
  clear(): void {
    this.current = undefined;
    this.publish();
  }

  /**
   * This selection left the screen without a successor taking its sequence (a machine switch
   * empties the selection in place): its reads will never settle, so it stops opening.
   */
  abandon(scope: SelectionScope): void {
    if (this.current !== undefined && sameSelection(this.current.scope, scope)) this.clear();
  }

  untilSettled(place: SelectionPlace): Promise<void> {
    if (!this.isOpening(place)) return Promise.resolve();
    return new Promise((release) => { this.waiters.push({ place, release }); });
  }

  private isOpening(place: SelectionPlace): boolean {
    const current = this.current;
    return current !== undefined && samePlace(current.scope, place) && [...current.reads.values()].includes("pending");
  }

  private publish(): void {
    const scope = this.current?.scope;
    this.onOpeningChange(scope !== undefined && this.isOpening(scope));
    const released = this.waiters.filter((waiter) => !this.isOpening(waiter.place));
    this.waiters = this.waiters.filter((waiter) => this.isOpening(waiter.place));
    for (const waiter of released) waiter.release();
  }
}
