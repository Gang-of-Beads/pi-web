import type { ClientSession } from "../../shared/types.js";
import { CreationUnknownError } from "./sessionErrors.js";

/** One browser creation intent: the directory and the startup token the browser minted for it. */
interface SessionCreationScope {
  cwd: string;
  startupToken: string;
}

/** What answering a repeat needs from the session service. */
interface SessionCreationAnswerSteps {
  /** A repeat arrived while the startup still runs: tell its browser which session it is waiting on. */
  joined(sessionId: string): void;
  /** A repeat arrived after the startup made the session: find it the normal way. */
  created(sessionId: string): Promise<ClientSession>;
}

/** What a creation needs from the session service. */
interface SessionCreationSteps extends SessionCreationAnswerSteps {
  /** Allocate the session, its id known at once, and the startup that makes it. */
  allocate(): { sessionId: string; start(): Promise<ClientSession> };
}

interface CreationEntry {
  answer(steps: SessionCreationAnswerSteps): Promise<ClientSession>;
  settledAt?: number;
}

/** How long a created session still answers a repeat of its token. */
const CREATED_MEMORY_MS = 24 * 60 * 60 * 1000;

function creationKey(scope: SessionCreationScope): string {
  return JSON.stringify([scope.cwd, scope.startupToken]);
}

/** Built outside `run` so the entry holds the id alone, not the creation's promise or session. */
function createdEntry(sessionId: string, settledAt: number): CreationEntry {
  return { answer: (steps) => steps.created(sessionId), settledAt };
}

/**
 * At most one session per creation intent, however often its request is repeated (r44). The web
 * proxy answers a create the daemon has not finished within 25 s with a 504, and the browser then
 * asks again under the same token: that repeat joins the startup still running instead of
 * allocating another session, and, for a day after it made the session, answers that session.
 * The directory and the token name the whole creation: a repeat's other create options are not read.
 *
 * A refused creation is forgotten at once: a failed startup removes its runtime and pi writes no
 * session file before the first conversation message, so nothing of it is left to answer with,
 * and a repeat after the cause was fixed (a folder restored) creates the session. Held in memory
 * only: a daemon restart drops an unwritten session with its creation, so a repeat after it
 * creates the one session there is.
 */
export class SessionCreations {
  private readonly entries = new Map<string, CreationEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  run(scope: SessionCreationScope, steps: SessionCreationSteps): Promise<ClientSession> {
    const key = creationKey(scope);
    const known = this.liveEntry(key);
    if (known !== undefined) return known.answer(steps);
    const allocated = steps.allocate();
    const sessionId = allocated.sessionId;
    const outcome = allocated.start();
    const running: CreationEntry = {
      answer: (joining) => {
        joining.joined(sessionId);
        return outcome;
      },
    };
    this.entries.set(key, running);
    const stillRunning = (): boolean => this.entries.get(key) === running;
    outcome.then(
      () => { if (stillRunning()) this.entries.set(key, createdEntry(sessionId, this.now())); },
      () => { if (stillRunning()) this.entries.delete(key); },
    );
    return outcome;
  }

  /**
   * Answer a repeat that must never create: a page rebuilding, in the background, a creation it
   * started before a reload. The creation running or remembered, or `CreationUnknownError`.
   */
  join(scope: SessionCreationScope, steps: SessionCreationAnswerSteps): Promise<ClientSession> {
    const known = this.liveEntry(creationKey(scope));
    return known === undefined ? Promise.reject(new CreationUnknownError()) : known.answer(steps);
  }

  /** The entry for a key, once settled creations older than the memory window are forgotten. */
  private liveEntry(key: string): CreationEntry | undefined {
    this.forgetCreatedBefore(this.now() - CREATED_MEMORY_MS);
    return this.entries.get(key);
  }

  private forgetCreatedBefore(cutoff: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.settledAt !== undefined && entry.settledAt < cutoff) this.entries.delete(key);
    }
  }
}
