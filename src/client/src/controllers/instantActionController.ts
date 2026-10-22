import { REQUEST_TIMEOUT_MS } from "../api/requestDeadline";
import {
  answerWhileLanding,
  instantBarWords,
  instantReturnWords,
  instantTransition,
  instantUndoRefusedWords,
  REVERSE,
  UNDOABLE,
  type InstantAction,
  type InstantActionKind,
  type InstantAnswer,
  type InstantBarWords,
  type InstantDock,
  type InstantEvent,
  type InstantPhase,
} from "../instantActions";

/** How long Undo stays offered (owner, 2026-10-21). */
export const UNDO_WINDOW_MS = 5000;
/** How long a row that went back keeps its reason under its name. */
const RETURNED_MARK_MS = 6000;
/** Reads that settle an unanswered request start after this and back off up to the cap. */
const CONFIRM_READ_FIRST_MS = 2000;
const CONFIRM_READ_CAP_MS = 30_000;
/** Nothing stands after an Undo whose reverse was done everywhere. */
const NOTHING_STANDS: InstantAnswer = { doneIds: [], refused: [], unansweredIds: [] };

/** What the host does for one kind of action, on the machine and in its own state. */
export interface InstantKindExecutor {
  /** Send the request; `keepalive` when the page is going away. Answers per target and never throws. */
  send(action: InstantAction, keepalive: boolean): Promise<InstantAnswer>;
  /** Read the machine and say per target whether the action happened; unanswered while it cannot be read. */
  read(action: InstantAction): Promise<InstantAnswer>;
  /** The machine did it: carry it into the app's own state and lists. */
  apply(action: InstantAction): Promise<void>;
}

export interface InstantActionControllerDependencies {
  readonly executors: Readonly<Record<InstantActionKind, InstantKindExecutor>>;
  readonly notice: (text: string, machineId: string) => void;
  readonly changed: () => void;
  readonly now?: () => number;
}

export type InstantActionStart = Pick<InstantAction, "kind" | "machineId" | "machineName" | "dock" | "targets" | "note" | "cleanupRequest">;

/** The open Undo window, as the bar draws it. */
export interface UndoBarView {
  readonly actionId: number;
  readonly words: InstantBarWords;
  /** How far the window has run, for the countdown line. */
  readonly elapsedMs: number;
  readonly paused: boolean;
}

/** Until when a read may predate the request it settles, and whether a row it shows moved is an answer meanwhile. */
interface ReadsLanding {
  readonly until: number;
  readonly movedIsAnswer: boolean;
}

interface UndoWindow {
  readonly actionId: number;
  remainingMs: number;
  runningSince: number | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  readonly pauses: Set<string>;
}

/**
 * Runs the instant actions (`instantActions.ts`): the one Undo window, its pauses, the requests,
 * the reads that settle an unanswered one, and the drops once a row is settled. Every phase has
 * one executor, entered when an action moves into it.
 *
 * One window at a time: a new action ends the previous one's window, and a held action is sent
 * then. Every action pressed opens one, with or without a bar to draw it, so Ctrl/Cmd+Z always
 * undoes the newest. A page that is hidden sends what it held at once, with a keepalive request,
 * and pauses the window of what it already sent.
 *
 * Once disposed it starts nothing more: answers still on their way change no state and arm no timer.
 */
export class InstantActionController {
  private actions: InstantAction[] = [];
  private window: UndoWindow | undefined;
  private seq = 0;
  private readonly sends = new Map<number, Promise<InstantAnswer>>();
  private readonly keepalive = new Set<number>();
  private readonly applied = new Set<number>();
  private readonly landing = new Map<number, ReadsLanding>();
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly now: () => number;
  private disposed = false;

  constructor(private readonly deps: InstantActionControllerDependencies) {
    this.now = deps.now ?? (() => Date.now());
  }

  list(): readonly InstantAction[] {
    return this.actions;
  }

  /** The action pressed: shown moved now, then delivered as its kind is. */
  start(input: InstantActionStart): void {
    if (input.targets.length === 0) return;
    this.seq += 1;
    const action: InstantAction = { ...input, id: this.seq, returned: [], phase: "optimistic", pressedAt: new Date(this.now()).toISOString() };
    this.actions = [...this.actions, action];
    this.enter(action);
    this.deps.changed();
  }

  /** Undo the newest action while its window is open; false when there is none. */
  undoLatest(): boolean {
    const open = this.window;
    return open !== undefined && this.undo(open.actionId);
  }

  undo(actionId: number): boolean {
    const action = this.find(actionId);
    if (action === undefined || this.window?.actionId !== actionId || !UNDOABLE[action.phase]) return false;
    this.closeWindow();
    this.dispatch(actionId, { type: "undo" });
    return true;
  }

  /** End the open window now: what it held is sent. Leaving the list or the machine ends it. */
  endWindow(): void {
    const open = this.window;
    if (open === undefined) return;
    this.closeWindow();
    this.dispatch(open.actionId, { type: "window-ended" });
    this.dropIfSettled(open.actionId);
    this.deps.changed();
  }

  /** A finger, the pointer or focus on the bar, or the page hidden, holds the countdown. */
  pause(reason: string): void {
    const open = this.window;
    if (open === undefined || open.pauses.has(reason)) return;
    open.pauses.add(reason);
    if (open.runningSince === undefined) return;
    open.remainingMs = Math.max(0, open.remainingMs - (this.now() - open.runningSince));
    open.runningSince = undefined;
    if (open.timer !== undefined) clearTimeout(open.timer);
    open.timer = undefined;
    this.deps.changed();
  }

  resume(reason: string): void {
    const open = this.window;
    if (open === undefined || !open.pauses.delete(reason) || open.pauses.size > 0) return;
    this.run(open);
    this.deps.changed();
  }

  /** The page went to the background or is being unloaded: a held action is sent now, kept alive; a sent one's window waits. */
  pageHidden(): void {
    const open = this.window;
    if (open === undefined) return;
    if (this.find(open.actionId)?.phase === "held") {
      this.keepalive.add(open.actionId);
      this.endWindow();
      return;
    }
    this.pause("hidden");
  }

  pageShown(): void {
    this.resume("hidden");
  }

  /** The bar for a dock, while its action's window is open. */
  bar(dock: InstantDock): UndoBarView | undefined {
    const open = this.window;
    const action = open === undefined ? undefined : this.find(open.actionId);
    if (open === undefined || action?.dock !== dock) return undefined;
    const running = open.runningSince === undefined ? 0 : this.now() - open.runningSince;
    return { actionId: action.id, words: instantBarWords(action), elapsedMs: Math.min(UNDO_WINDOW_MS, UNDO_WINDOW_MS - open.remainingMs + running), paused: open.runningSince === undefined };
  }

  dispose(): void {
    this.disposed = true;
    if (this.window?.timer !== undefined) clearTimeout(this.window.timer);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private readonly executors: Readonly<Record<InstantPhase, (action: InstantAction, previous: InstantPhase) => void>> = {
    optimistic: (action) => { this.dispatch(action.id, { type: "deliver" }); },
    held: (action) => { this.openWindow(action); },
    sent: (action, previous) => {
      if (previous === "optimistic") this.openWindow(action);
      void this.send(action);
    },
    unconfirmed: (action) => { this.scheduleRead(action.id, 0); },
    undoing: (action) => { void this.reverse(action); },
    confirmed: (action) => { void this.applyConfirmed(action); },
    reverted: (action) => { this.settleReverted(action); },
  };

  private dispatch(actionId: number, event: InstantEvent): void {
    if (this.disposed) return;
    const action = this.find(actionId);
    if (action === undefined) return;
    const next = instantTransition(action, event);
    if (next === action) return;
    this.actions = this.actions.map((candidate) => (candidate.id === actionId ? next : candidate));
    if (next.phase !== action.phase) this.executors[next.phase](next, action.phase);
    this.deps.changed();
  }

  private enter(action: InstantAction): void {
    this.executors[action.phase](action, action.phase);
  }

  private async send(action: InstantAction): Promise<void> {
    const keepalive = this.keepalive.delete(action.id);
    this.landing.set(action.id, { until: this.now() + REQUEST_TIMEOUT_MS, movedIsAnswer: true });
    const answer = this.deps.executors[action.kind].send(action, keepalive);
    this.sends.set(action.id, answer);
    this.dispatch(action.id, { type: "answered", answer: await answer });
  }

  /**
   * Undo of what was sent at once: the reverse goes to the rows the request reached. Where it is
   * refused, a read says whether the action still stands there (a refusal can mean it never
   * landed), so the original is carried again only where it does; where it got no answer, the row
   * waits for a read made once the reverse can no longer be landing.
   */
  private async reverse(action: InstantAction): Promise<void> {
    const original = await this.sends.get(action.id);
    const reached = original === undefined ? action.targets : action.targets.filter((target) => original.doneIds.includes(target.id) || original.unansweredIds.includes(target.id));
    const reverseKind = REVERSE[action.kind];
    if (reached.length === 0 || reverseKind === undefined) {
      this.dispatch(action.id, { type: "reverse-answered", standing: NOTHING_STANDS });
      return;
    }
    const reversal: InstantAction = { ...action, kind: reverseKind, targets: reached };
    const sentAt = this.now();
    const answer = await this.deps.executors[reverseKind].send(reversal, false);
    const standing = await this.standingAfterReverse(action, answer);
    const undone = reached.filter((target) => !standing.doneIds.includes(target.id) && !standing.unansweredIds.includes(target.id));
    if (undone.length > 0) await this.applySafely({ ...reversal, targets: undone });
    const refused = answer.refused.find((entry) => standing.doneIds.includes(entry.id));
    if (refused !== undefined) this.deps.notice(instantUndoRefusedWords(action, refused.reason), action.machineId);
    if (standing.unansweredIds.length > 0) this.landing.set(action.id, { until: sentAt + REQUEST_TIMEOUT_MS, movedIsAnswer: false });
    this.dispatch(action.id, { type: "reverse-answered", standing });
  }

  /** Where the action stands once its reverse answered: undone where the reverse was done, read from the machine where it was refused, unknown where it got no answer. */
  private async standingAfterReverse(action: InstantAction, reverse: InstantAnswer): Promise<InstantAnswer> {
    if (reverse.refused.length === 0) return { ...NOTHING_STANDS, unansweredIds: reverse.unansweredIds };
    const refusedIds = new Set(reverse.refused.map((entry) => entry.id));
    const read = await this.deps.executors[action.kind].read(action);
    return {
      doneIds: read.doneIds.filter((id) => refusedIds.has(id)),
      refused: [],
      unansweredIds: [...reverse.unansweredIds, ...read.unansweredIds.filter((id) => refusedIds.has(id))],
    };
  }

  /**
   * An unanswered request is settled by reading the machine: first after a short wait, then on a
   * growing interval while it cannot be read. A read made before the request's deadline may
   * predate it landing (a remote package removal outlives the timeout; a read can join one already
   * on its way), so until then it settles only what it shows moved.
   */
  private scheduleRead(actionId: number, attempt: number): void {
    const delay = Math.min(CONFIRM_READ_CAP_MS, CONFIRM_READ_FIRST_MS * 2 ** attempt);
    this.later(actionId, delay, async () => {
      const action = this.find(actionId);
      if (action?.phase !== "unconfirmed") return;
      const readAt = this.now();
      const answer = await this.deps.executors[action.kind].read(action);
      const landing = this.landing.get(actionId);
      const settling = landing === undefined || readAt >= landing.until ? answer : answerWhileLanding(action, answer, landing.movedIsAnswer);
      this.dispatch(actionId, { type: "read", answer: settling });
      if (this.find(actionId)?.phase === "unconfirmed") this.scheduleRead(actionId, attempt + 1);
    });
  }

  private async applyConfirmed(action: InstantAction): Promise<void> {
    if (action.returned.length > 0) this.noticeReturned(action);
    await this.applySafely(action);
    this.applied.add(action.id);
    this.dropIfSettled(action.id);
  }

  /** Carry what the machine did into the page; a failure there is logged and the action still settles, so its rows are never left hidden. */
  private async applySafely(action: InstantAction): Promise<void> {
    try {
      await this.deps.executors[action.kind].apply(action);
    } catch (error) {
      console.warn(`Could not carry ${action.kind} on ${action.machineName} into the page`, error);
    }
  }

  private settleReverted(action: InstantAction): void {
    if (this.window?.actionId === action.id) this.closeWindow();
    if (action.returned.length === 0) {
      this.drop(action.id);
      return;
    }
    this.noticeReturned(action);
    this.later(action.id, RETURNED_MARK_MS, () => { this.drop(action.id); });
  }

  private noticeReturned(action: InstantAction): void {
    const words = instantReturnWords(action);
    if (words !== undefined) this.deps.notice(words, action.machineId);
  }

  private openWindow(action: InstantAction): void {
    this.endWindow();
    const open: UndoWindow = { actionId: action.id, remainingMs: UNDO_WINDOW_MS, runningSince: undefined, timer: undefined, pauses: new Set() };
    this.window = open;
    this.run(open);
  }

  private run(open: UndoWindow): void {
    if (this.disposed) return;
    open.runningSince = this.now();
    open.timer = setTimeout(() => {
      open.timer = undefined;
      if (this.window === open) this.endWindow();
    }, open.remainingMs);
  }

  private closeWindow(): void {
    if (this.window?.timer !== undefined) clearTimeout(this.window.timer);
    this.window = undefined;
  }

  /** A confirmed action whose window is over and whose result the app carries now is no longer drawn over the lists; a reverted one drops in `settleReverted`. */
  private dropIfSettled(actionId: number): void {
    if (this.window?.actionId === actionId) return;
    const action = this.find(actionId);
    if (action === undefined) return;
    if (action.phase === "confirmed" && this.applied.has(actionId)) this.drop(actionId);
  }

  private drop(actionId: number): void {
    this.actions = this.actions.filter((action) => action.id !== actionId);
    this.sends.delete(actionId);
    this.applied.delete(actionId);
    this.landing.delete(actionId);
    const timer = this.timers.get(actionId);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(actionId);
    this.deps.changed();
  }

  private later(actionId: number, delayMs: number, run: () => void | Promise<void>): void {
    if (this.disposed) return;
    const previous = this.timers.get(actionId);
    if (previous !== undefined) clearTimeout(previous);
    this.timers.set(actionId, setTimeout(() => {
      this.timers.delete(actionId);
      void run();
    }, delayMs));
  }

  private find(actionId: number): InstantAction | undefined {
    return this.actions.find((action) => action.id === actionId);
  }
}
