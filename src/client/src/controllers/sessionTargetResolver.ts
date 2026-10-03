import type { SessionInfo, SessionRef } from "../../../shared/apiTypes";
import type { SessionLocation } from "../api/clients";
import { isResolved, targetFromLocateError, targetFromLocation, type ScopedSessionTarget, type SessionTarget, type SessionTargetScope } from "../sessionTarget";
import { QUIET_WINDOW_MS, retryDelayMs } from "../sync/readPhase";

/**
 * How an answered target opens: a restore keeps the URL it came from. `correctsUrl` is a reopen of
 * a session the URL already names, found elsewhere: its place replaces that entry (D8).
 */
export interface SessionTargetOpenOptions {
  readonly updateUrl?: boolean | undefined;
  readonly correctsUrl?: boolean | undefined;
}

export interface SessionTargetResolverDeps {
  locate(ref: SessionRef, machineId: string): Promise<SessionLocation>;
  publish(target: ScopedSessionTarget | undefined): void;
  open(session: SessionInfo, options: SessionTargetOpenOptions): Promise<void>;
  readonly schedule?: (run: () => void, ms: number) => () => void;
  readonly now?: () => number;
  /** A session that fails to open after a retry has no caller left to tell; it goes here. */
  readonly reportError?: (error: unknown) => void;
}

/**
 * Carries one named session from the listing's verdict to an answer
 * (state-diagram D8, "The target of a session link"; P2 slice b).
 *
 * A session the listing has opens at once. One it lacks is asked about
 * machine-wide. An unanswered ask is repeated on the read ladder and never
 * given up (B48). A newer navigation drops the target: a late answer then
 * changes nothing, and no retry is left behind.
 */
export class SessionTargetResolver {
  private generation = 0;
  private cancelRetry: (() => void) | undefined;
  private shown = false;
  private firstMissAt: number | undefined;
  private readonly schedule: (run: () => void, ms: number) => () => void;

  constructor(private readonly deps: SessionTargetResolverDeps) {
    this.schedule = deps.schedule ?? scheduleWithTimer;
  }

  async follow(scope: SessionTargetScope, target: SessionTarget, options: SessionTargetOpenOptions = {}): Promise<void> {
    this.drop();
    const generation = this.generation;
    await this.settle({ scope, options, generation }, target, 0);
  }

  /** Forget the target: the reader went elsewhere, or a session was selected. What it showed goes with it. */
  drop(): void {
    this.generation += 1;
    this.cancelRetry?.();
    this.cancelRetry = undefined;
    this.firstMissAt = undefined;
    if (!this.shown) return;
    this.shown = false;
    this.deps.publish(undefined);
  }

  dispose(): void {
    this.drop();
  }

  private async settle(following: Following, target: SessionTarget, attempt: number): Promise<void> {
    if (target.kind === "open" || target.kind === "archived") {
      await this.deps.open(target.session, following.options);
      return;
    }
    this.shown = true;
    this.deps.publish({ ...following.scope, target, unansweredSince: this.unansweredSince(target) });
    if (isResolved(target)) return;
    if (target.kind === "asking") {
      await this.ask(following, attempt);
      return;
    }
    this.cancelRetry = this.schedule(() => {
      this.cancelRetry = undefined;
      this.ask(following, attempt + 1).catch((error: unknown) => { this.deps.reportError?.(error); });
    }, retryDelayMs(attempt, QUIET_WINDOW_MS));
  }

  private async ask(following: Following, attempt: number): Promise<void> {
    const { scope } = following;
    const next = await this.deps.locate({ id: scope.sessionId, cwd: scope.cwd }, scope.machineId).then(
      (location) => targetFromLocation(scope.sessionId, location),
      (error: unknown) => targetFromLocateError(scope.sessionId, error),
    );
    if (!this.isCurrent(following.generation)) return;
    await this.settle(following, next, attempt);
  }

  private unansweredSince(target: SessionTarget): number | undefined {
    if (target.kind !== "unknown") return undefined;
    this.firstMissAt ??= (this.deps.now ?? Date.now)();
    return this.firstMissAt;
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}

interface Following {
  readonly scope: SessionTargetScope;
  readonly options: SessionTargetOpenOptions;
  readonly generation: number;
}

function scheduleWithTimer(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  return () => { clearTimeout(timer); };
}
