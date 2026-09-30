import { projectsApi, sessionsApi, workspacesApi, type Project } from "../api";
import { QUIET_WINDOW_MS } from "../sync/readPhase";
import { ScopedResource, type ResourceClock } from "../sync/scopedResource";
import { boardAnswer, completeSessionBoard, readSessionBoard, type BoardAnswer, type SessionBoard, type SessionBoardSources } from "../sync/sessionBoard";

/** How long a board read whole stays fresh: browsing it again reads no more than its gaps. */
const BOARD_FRESH_MS = 30_000;

export interface SessionBoardControllerDependencies {
  /** The listings of one machine; the default reads the machine's API. */
  sources?: (machineId: string) => SessionBoardSources;
  /** The projects already known for a machine, so the board does not read them twice. */
  knownProjects?: (machineId: string) => readonly Project[] | undefined;
  clock?: ResourceClock;
  now?: () => number;
}

/**
 * The machine-wide session board the navigation page and the quick switcher
 * list (object model §1.5, P1 slice 5).
 *
 * One board per machine, read until every source answered: a lost read is
 * read again, and a partial one shows its rows and is read again, on the
 * shared backoff while the machine is the one browsed. The board is not an
 * app-row cause; one source not answering retries silently (owner Q4).
 */
export class SessionBoardController {
  private readonly boards: ScopedResource<string, SessionBoard>;
  private readonly fetchedAt = new Map<string, number>();
  /** Machines whose next read must be whole: the reader asked, or the board went stale. A retry of a partial board asks only its gaps. */
  private readonly wholeReadAsked = new Set<string>();
  private readonly now: () => number;
  private browsed: { machineId: string; release: () => void } | undefined;

  constructor(deps: SessionBoardControllerDependencies = {}) {
    const sources = deps.sources ?? defaultSources(deps.knownProjects);
    this.now = deps.now ?? (() => Date.now());
    this.boards = new ScopedResource<string, SessionBoard>({
      keyId: (machineId) => machineId,
      read: async (machineId) => {
        const askedWhole = this.wholeReadAsked.delete(machineId);
        const gaps = this.boards.entry(machineId).data;
        if (askedWhole || gaps === undefined || boardAnswer(gaps) === "complete") {
          try {
            const board = await readSessionBoard(sources(machineId));
            this.fetchedAt.set(machineId, this.now());
            return board;
          } catch (error) {
            if (askedWhole) this.wholeReadAsked.add(machineId);
            throw error;
          }
        }
        return completeSessionBoard(gaps, sources(machineId));
      },
      retryCapMs: QUIET_WINDOW_MS,
      complete: (board) => boardAnswer(board) === "complete",
      ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    });
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

  board(machineId: string): SessionBoard | undefined {
    return this.boards.entry(machineId).data;
  }

  answer(machineId: string): BoardAnswer {
    return boardAnswer(this.board(machineId));
  }

  /** Apply a change this client made to a known board, such as a rename. */
  update(machineId: string, change: (board: SessionBoard) => SessionBoard): void {
    this.boards.update(machineId, change);
  }

  subscribe(listener: () => void): () => void {
    return this.boards.subscribe(listener);
  }

  /** A sign of life: read a board that is still waiting on a source now. */
  wake(): void {
    this.boards.wake();
  }

  dispose(): void {
    this.boards.dispose();
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

function defaultSources(knownProjects: SessionBoardControllerDependencies["knownProjects"]): (machineId: string) => SessionBoardSources {
  return (machineId) => ({
    projects: () => {
      const known = knownProjects?.(machineId);
      return known === undefined ? projectsApi.projects(machineId) : Promise.resolve(known);
    },
    workspaces: (projectId) => workspacesApi.workspaces(projectId, machineId),
    sessions: (workspacePath) => sessionsApi.sessions(workspacePath, machineId),
  });
}
