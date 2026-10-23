import { projectsApi, sessionsApi, workspacesApi, type Project, type SessionInfo } from "../api";
import type { ReadAsker } from "../api/http";
import { isSessionNotFoundError } from "../sessionNotFound";
import { MACHINE_WIDE_LOCATE_START } from "../sessionTarget";
import { QUIET_WINDOW_MS, type ReadFact } from "../sync/readPhase";
import { ScopedResource, type ResourceClock } from "../sync/scopedResource";
import { boardAnswer, boardFilledFromMemory, boardWithEvent, completeSessionBoard, oneReadBoard, readSessionBoard, type BoardAnswer, type SessionBoard, type SessionBoardEvent, type SessionBoardSources } from "../sync/sessionBoard";
import type { BoardMemory } from "../sync/boardMemory";

/** How long a board read whole stays fresh: browsing it again reads no more than its gaps. */
const BOARD_FRESH_MS = 30_000;

/**
 * How long a list waits for the live board before it draws the remembered one (owner,
 * 2026-10-07): an answer inside this window is the first paint, with nothing to replace; past
 * it the reader sees the remembered rows and the answer slides in when it lands.
 */
export const REMEMBERED_HOLD_MS = 500;

export interface SessionBoardControllerDependencies {
  /** The listings of one machine, for whoever waits on the read; the default reads the machine's API. */
  sources?: (machineId: string, asker: ReadAsker) => SessionBoardSources;
  /** The projects already known for a machine, so the board does not read them twice. */
  knownProjects?: (machineId: string) => readonly Project[] | undefined;
  clock?: ResourceClock;
  now?: () => number;
  /** Boards remembered from an earlier visit, drawn until this page's own read answers. */
  memory?: BoardMemory;
}

/**
 * The machine-wide session board the navigation page and the quick switcher
 * list (object model §1.5, P1 slice 5).
 *
 * One board per machine, read until every source answered: a lost read is
 * read again, and a partial one shows its rows and is read again, on the
 * shared backoff while the machine is the one browsed. The board is not an
 * app-row cause; one source not answering retries silently (owner Q4).
 *
 * Until a machine's first read answers, its board is the one this browser
 * remembered (`boardMemory.ts`): drawn once the live answer has had
 * REMEMBERED_HOLD_MS to arrive, never counted as an answer, and not drawn at
 * all once the machine stated a refusal. A partial answer keeps the
 * remembered rows of the sources that did not answer.
 */
export class SessionBoardController {
  private readonly boards: ScopedResource<string, SessionBoard>;
  private readonly fetchedAt = new Map<string, number>();
  /** Machines whose next read must be whole: the reader asked, or the board went stale. A retry of a partial board asks only its gaps. */
  private readonly wholeReadAsked = new Set<string>();
  private readonly now: () => number;
  private browsed: { machineId: string; release: () => void } | undefined;
  private readonly memory: BoardMemory | undefined;
  /** What memory held for each machine asked about, with the announcements heard since applied. */
  private readonly remembered = new Map<string, SessionBoard | undefined>();
  /** The live board last handed to memory per machine, so an unchanged one is not written again. */
  private readonly lastRemembered = new Map<string, SessionBoard>();
  /** Machines whose board this page has read, the ones memory may be handed. */
  private readonly readMachines = new Set<string>();
  /** When each machine's wait for its live board ends; set the first time its board is asked for. */
  private readonly holdEnds = new Map<string, number>();
  private readonly holdListeners = new Set<() => void>();
  private readonly setTimer: (callback: () => void, delayMs: number) => void;
  private readonly sources: (machineId: string, asker: ReadAsker) => SessionBoardSources;

  constructor(deps: SessionBoardControllerDependencies = {}) {
    const sources = deps.sources ?? defaultSources(deps.knownProjects);
    this.sources = sources;
    this.now = deps.now ?? (() => Date.now());
    this.memory = deps.memory;
    const clock = deps.clock;
    this.setTimer = clock === undefined ? (callback, delayMs) => { globalThis.setTimeout(callback, delayMs); } : (callback, delayMs) => { clock.setTimer(callback, delayMs); };
    this.boards = new ScopedResource<string, SessionBoard>({
      keyId: (machineId) => machineId,
      read: async (machineId) => {
        this.readMachines.add(machineId);
        const askedWhole = this.wholeReadAsked.delete(machineId);
        const gaps = this.boards.entry(machineId).data;
        if (askedWhole || gaps === undefined || boardAnswer(gaps) === "complete") {
          try {
            const board = await readSessionBoard(sources(machineId, this.askerOf(machineId)));
            this.fetchedAt.set(machineId, this.now());
            return board;
          } catch (error) {
            if (askedWhole) this.wholeReadAsked.add(machineId);
            throw error;
          }
        }
        return completeSessionBoard(gaps, sources(machineId, this.askerOf(machineId)));
      },
      retryCapMs: QUIET_WINDOW_MS,
      complete: (board) => boardAnswer(board) === "complete",
      ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    });
    if (this.memory !== undefined) this.boards.subscribe(() => { this.rememberLiveBoards(); });
  }

  /**
   * Show a machine's board: keep it read while it is the one browsed, and read
   * it now - whole, unless it was read whole moments ago, when a partial board
   * only has its gaps filled and a complete one is not read at all. A read
   * already in flight is joined. `force` reads it whole now regardless, after
   * a change this client made.
   */
  async browse(machineId: string, options: { force?: boolean } = {}): Promise<void> {
    this.follow(machineId);
    await this.read(machineId, options);
  }

  /**
   * Read a machine's board as `browse` does, without making it the browsed one: for a reader of
   * several machines' boards at once (a plugin's fleet page), which holds its own `watch`.
   */
  async read(machineId: string, options: { force?: boolean } = {}): Promise<void> {
    if (options.force !== true) {
      const inFlight = this.boards.join(machineId);
      if (inFlight !== undefined) {
        await inFlight;
        return;
      }
      if (this.isFresh(machineId)) {
        if (this.answer(machineId) === "partial") await this.boards.refresh(machineId);
        return;
      }
    }
    this.wholeReadAsked.add(machineId);
    await this.boards.refresh(machineId);
  }

  /**
   * The board to draw: the live one, with remembered rows for the sources it could not read; else,
   * once the wait for it is over, the remembered one while the machine has neither answered nor
   * refused.
   */
  board(machineId: string): SessionBoard | undefined {
    const entry = this.boards.entry(machineId);
    const live = this.liveBoard(machineId);
    if (live !== undefined) return live;
    if (entry.fact.kind !== "none" || this.waitingForLive(machineId)) return undefined;
    return this.recall(machineId);
  }

  /** The live board only, with remembered rows for the sources it could not read; undefined until a read answered. */
  liveBoard(machineId: string): SessionBoard | undefined {
    const live = this.boards.entry(machineId).data;
    if (live === undefined) return undefined;
    return boardAnswer(live) === "complete" ? live : boardFilledFromMemory(live, this.recall(machineId));
  }

  /** Whether this page has started reading the machine's board, and what the machine stated about the read ("none" when it stated nothing). */
  readState(machineId: string): { readonly asked: boolean; readonly fact: ReadFact["kind"] } {
    return { asked: this.readMachines.has(machineId), fact: this.boards.entry(machineId).fact.kind };
  }

  /** Keep a machine's board read again by itself while it lacks an answer, for as long as the returned release is not called. */
  watch(machineId: string): () => void {
    return this.boards.watch(machineId);
  }

  /**
   * The board this browser knows now, for a reader that acts on it rather than draws it: the live
   * one, else the remembered one at once, without the wait that keeps the drawn list from flashing.
   */
  known(machineId: string): SessionBoard | undefined {
    return this.boards.entry(machineId).data ?? this.recall(machineId);
  }

  /** How much of the live board answered; a remembered board is no answer. */
  answer(machineId: string): BoardAnswer {
    return boardAnswer(this.boards.entry(machineId).data);
  }

  /**
   * A whole read of a machine's board made now, for a reader that must know what the machine holds
   * after a request it sent (an archive with no answer); undefined when not every source answered.
   */
  async readWhole(machineId: string): Promise<SessionBoard | undefined> {
    const board = await readSessionBoard(this.sources(machineId, "reader")).catch((): undefined => undefined);
    return board !== undefined && boardAnswer(board) === "complete" ? board : undefined;
  }

  /** Apply a change this client made to a known board, such as a rename. */
  update(machineId: string, change: (board: SessionBoard) => SessionBoard): void {
    this.boards.update(machineId, change);
  }

  /** Take what a machine announced about its sessions, so the board stays live between reads (D5). */
  applyEvent(machineId: string, event: SessionBoardEvent): void {
    const remembered = this.recall(machineId);
    if (remembered !== undefined) this.remembered.set(machineId, boardWithEvent(remembered, event));
    this.boards.update(machineId, (board) => boardWithEvent(board, event));
  }

  subscribe(listener: () => void): () => void {
    this.holdListeners.add(listener);
    const unsubscribe = this.boards.subscribe(listener);
    return () => {
      this.holdListeners.delete(listener);
      unsubscribe();
    };
  }

  /**
   * The machine announced something this page did not hear (state-diagram D5, "A lost announcement
   * is noticed"): its board is no longer known fresh. The browsed one is read whole now; any other
   * is read whole the next time it is shown.
   */
  missedAnnouncements(machineId: string): void {
    this.fetchedAt.delete(machineId);
    if (this.browsed?.machineId === machineId) void this.browse(machineId, { force: true });
  }

  /** A sign of life: read a board that is still waiting on a source now. */
  wake(): void {
    this.boards.wake();
  }

  dispose(): void {
    this.boards.dispose();
    this.holdListeners.clear();
  }

  /** The first ask starts the machine's wait; its end asks every listener to draw again. */
  private waitingForLive(machineId: string): boolean {
    if (this.memory === undefined) return false;
    const ends = this.holdEnds.get(machineId);
    if (ends !== undefined) return this.now() < ends;
    this.holdEnds.set(machineId, this.now() + REMEMBERED_HOLD_MS);
    this.setTimer(() => { for (const listener of [...this.holdListeners]) listener(); }, REMEMBERED_HOLD_MS);
    return true;
  }

  private recall(machineId: string): SessionBoard | undefined {
    if (!this.remembered.has(machineId)) this.remembered.set(machineId, this.memory?.recall(machineId));
    return this.remembered.get(machineId);
  }

  /** Hand every live board that changed to memory, which keeps the latest and writes it at most once a second. */
  private rememberLiveBoards(): void {
    for (const machineId of this.readMachines) {
      const board = this.boards.entry(machineId).data;
      if (board === undefined || this.lastRemembered.get(machineId) === board) continue;
      this.lastRemembered.set(machineId, board);
      this.memory?.remember(machineId, board);
    }
  }

  /**
   * The browsed machine's board is the reader's and keeps its budget; any other board (a plugin
   * watching the fleet's boards) is read by the page on its own and gives up at the machine read
   * deadline (r156), keeping what it last knew of that machine.
   */
  private askerOf(machineId: string): ReadAsker {
    return this.browsed?.machineId === machineId ? "reader" : "background";
  }

  private follow(machineId: string): void {
    if (this.browsed?.machineId === machineId) return;
    this.browsed?.release();
    this.browsed = { machineId, release: this.boards.watch(machineId) };
  }

  /** Read whole moments ago; a partial board that is fresh only has its gaps filled. */
  private isFresh(machineId: string): boolean {
    const fetchedAt = this.fetchedAt.get(machineId);
    return fetchedAt !== undefined && this.now() - fetchedAt < BOARD_FRESH_MS;
  }
}

function defaultSources(knownProjects: SessionBoardControllerDependencies["knownProjects"]): (machineId: string, asker: ReadAsker) => SessionBoardSources {
  const boardReads = new Map<string, () => ReturnType<NonNullable<SessionBoardSources["board"]>>>();
  const boardRead = (machineId: string, asker: ReadAsker) => {
    const key = JSON.stringify([machineId, asker]);
    const known = boardReads.get(key);
    if (known !== undefined) return known;
    const read = oneReadBoard(() => sessionsApi.sessionBoard(machineId, asker));
    boardReads.set(key, read);
    return read;
  };
  return (machineId, asker) => ({
    board: () => boardRead(machineId, asker)(),
    projects: () => {
      const known = knownProjects?.(machineId);
      return known === undefined ? projectsApi.projects(machineId, asker) : Promise.resolve(known);
    },
    workspaces: (projectId) => workspacesApi.workspaces(projectId, machineId, asker),
    sessions: (workspacePath) => sessionsApi.sessions(workspacePath, machineId, asker),
    locatePin: (sessionId) => locateSessionOnMachine(sessionId, machineId, asker),
  });
}

/** Where a session is, from the daemon's machine-wide locate (B49): the session, gone, or a throw when there was no answer (a daemon without the route has none). */
export async function locateSessionOnMachine(sessionId: string, machineId: string, asker: ReadAsker = "reader"): Promise<SessionInfo | "gone"> {
  try {
    const location = await sessionsApi.locateSession({ id: sessionId, cwd: MACHINE_WIDE_LOCATE_START }, machineId, asker);
    if (location.kind === "found") return location.session;
    throw new Error("The machine cannot locate a session");
  } catch (error) {
    if (isSessionNotFoundError(error)) return "gone";
    throw error;
  }
}
