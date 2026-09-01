import { isSessionActive } from "../../../shared/activity.js";
import type { SessionActivity, SessionStatus, TerminalInfo } from "../../../shared/apiTypes.js";

/** One working directory that currently has session or terminal activity. */
export interface ActiveWorkspaceActivity {
  cwd: string;
  hasSessionActivity: boolean;
  hasTerminalActivity: boolean;
}

interface SessionRecord {
  cwd: string;
  status?: SessionStatus;
  activity?: SessionActivity;
}

interface TerminalRecord {
  cwd: string;
}

/**
 * In-memory record of which working directories currently have session or
 * terminal activity.
 *
 * It publishes nothing itself: attribution and roll-up belong to the machine
 * status projection, which this service notifies whenever the record changes.
 */
export class WorkspaceActivityService {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly terminals = new Map<string, TerminalRecord>();

  constructor(private readonly onChanged?: () => void) {}

  applySessionStatus(cwd: string, status: SessionStatus): void {
    const previous = sessionContribution(this.sessions.get(status.sessionId));
    const record = this.sessions.get(status.sessionId) ?? { cwd };
    record.cwd = cwd;
    record.status = status;
    if (!isSessionActive(status) && record.activity?.phase === "active") delete record.activity;
    this.sessions.set(status.sessionId, record);
    this.pruneIdleSession(status.sessionId);
    this.notifyContributionChanged(previous, sessionContribution(this.sessions.get(status.sessionId)));
  }

  applySessionActivity(cwd: string, activity: SessionActivity): void {
    const previous = sessionContribution(this.sessions.get(activity.sessionId));
    const record = this.sessions.get(activity.sessionId) ?? { cwd };
    record.cwd = cwd;
    record.activity = activity;
    this.sessions.set(activity.sessionId, record);
    this.pruneIdleSession(activity.sessionId);
    this.notifyContributionChanged(previous, sessionContribution(this.sessions.get(activity.sessionId)));
  }

  removeSession(sessionId: string, cwd?: string): void {
    const previous = sessionContribution(this.sessions.get(sessionId));
    this.sessions.delete(sessionId);
    // A supplied cwd is an explicit invalidation from a lifecycle owner that
    // may be reconciling state this recorder already pruned.
    if (previous !== undefined || cwd !== undefined && cwd !== "") this.onChanged?.();
  }

  reconcileSessionActivity(cwd: string, sessionIds: Iterable<string>): void {
    const knownSessionIds = new Set(sessionIds);
    let changed = false;
    for (const [sessionId, record] of this.sessions.entries()) {
      if (record.cwd !== cwd || knownSessionIds.has(sessionId)) continue;
      this.sessions.delete(sessionId);
      changed = true;
    }
    if (changed) this.onChanged?.();
  }

  updateTerminal(terminal: Pick<TerminalInfo, "id" | "cwd" | "exited">): void {
    const previous = terminalContribution(this.terminals.get(terminal.id));
    if (terminal.exited) this.terminals.delete(terminal.id);
    else this.terminals.set(terminal.id, { cwd: terminal.cwd });
    this.notifyContributionChanged(previous, terminalContribution(this.terminals.get(terminal.id)));
  }

  removeTerminal(terminalId: string, cwd?: string): void {
    const previous = terminalContribution(this.terminals.get(terminalId));
    this.terminals.delete(terminalId);
    if (previous !== undefined || cwd !== undefined && cwd !== "") this.onChanged?.();
  }

  snapshot(): { workspaces: ActiveWorkspaceActivity[] } {
    const workspaces = new Map<string, ActiveWorkspaceActivity>();
    const summary = (cwd: string): ActiveWorkspaceActivity => {
      let value = workspaces.get(cwd);
      if (value === undefined) {
        value = { cwd, hasSessionActivity: false, hasTerminalActivity: false };
        workspaces.set(cwd, value);
      }
      return value;
    };
    for (const record of this.sessions.values()) {
      if (isSessionActive(record.status, record.activity)) summary(record.cwd).hasSessionActivity = true;
    }
    for (const record of this.terminals.values()) summary(record.cwd).hasTerminalActivity = true;
    return { workspaces: [...workspaces.values()].sort((left, right) => left.cwd.localeCompare(right.cwd)) };
  }

  private pruneIdleSession(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (record !== undefined && !isSessionActive(record.status, record.activity)) this.sessions.delete(sessionId);
  }

  /** Machine status only depends on whether this source contributes a cwd. */
  private notifyContributionChanged(previous: string | undefined, current: string | undefined): void {
    if (previous === current) return;
    this.onChanged?.();
  }
}

function sessionContribution(record: SessionRecord | undefined): string | undefined {
  return record !== undefined && isSessionActive(record.status, record.activity) ? record.cwd : undefined;
}

function terminalContribution(record: TerminalRecord | undefined): string | undefined {
  return record?.cwd;
}
