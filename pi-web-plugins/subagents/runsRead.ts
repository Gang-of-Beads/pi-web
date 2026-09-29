import { subagentListState, type SubagentListState } from "./runRows.js";

/**
 * The runs panel's read of one session: a sequence number per read, one read in flight, and
 * an answer that only ever replaces an older one.
 *
 * The panel polls while children work. It used to start a read every tick whether or not the
 * last one had answered, so a slow machine got a pile of reads, and whichever answered last
 * won - an old list could land over a newer one. A failed poll also blanked a list the reader
 * was watching. A read that has not answered after `READ_PRESUMED_DEAD_MS` is presumed dead,
 * so a lost reply cannot stop the panel reading for good; its answer, should it still come,
 * is older than anything read since and is dropped.
 */
export const READ_PRESUMED_DEAD_MS = 20_000;

/** What the panel shows for the session it reads: the last answer, and whether the latest read failed. */
export interface RunsView {
  state: SubagentListState | undefined;
  refreshFailed: boolean;
}

const COULD_NOT_ASK: SubagentListState = { kind: "unknown", reason: "This machine could not be asked for the runs." };

export class RunsRead {
  private sessionFile: string | undefined;
  private shown: SubagentListState | undefined;
  private refreshFailed = false;
  private issued = 0;
  private applied = 0;
  private inFlight: { seq: number; startedAt: number } | undefined;

  constructor(
    private readonly ask: (sessionFile: string) => Promise<unknown>,
    private readonly changed: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** The session the panel reads, and what it has for it; undefined before this session was read. */
  view(sessionFile: string): RunsView | undefined {
    return this.sessionFile === sessionFile ? { state: this.shown, refreshFailed: this.refreshFailed } : undefined;
  }

  /** The session on screen. A new one starts over and reads at once. */
  select(sessionFile: string): void {
    if (this.sessionFile === sessionFile) return;
    this.sessionFile = sessionFile;
    this.shown = undefined;
    this.refreshFailed = false;
    this.inFlight = undefined;
    this.read();
  }

  /** A poll tick: read again unless a read of this session is still on its way. */
  tick(): void {
    if (this.sessionFile === undefined) return;
    if (this.inFlight !== undefined && this.now() - this.inFlight.startedAt < READ_PRESUMED_DEAD_MS) return;
    this.read();
  }

  private read(): void {
    const sessionFile = this.sessionFile;
    if (sessionFile === undefined) return;
    const seq = ++this.issued;
    this.inFlight = { seq, startedAt: this.now() };
    this.ask(sessionFile).then(
      (answer) => { this.settle(sessionFile, seq, subagentListState(answer)); },
      () => { this.settle(sessionFile, seq, undefined); },
    );
  }

  private settle(sessionFile: string, seq: number, answered: SubagentListState | undefined): void {
    if (this.sessionFile !== sessionFile) return;
    if (this.inFlight?.seq === seq) this.inFlight = undefined;
    if (seq < this.applied) return;
    this.applied = seq;
    if (answered !== undefined) {
      this.shown = answered;
      this.refreshFailed = false;
    } else if (this.shown?.kind === "rows") {
      this.refreshFailed = true;
    } else {
      this.shown = COULD_NOT_ASK;
    }
    this.changed();
  }
}
