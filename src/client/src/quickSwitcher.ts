import type { SessionActivity, SessionInfo, SessionStatus, Workspace } from "./api";
import { sessionActivityCategory } from "../../shared/sessionActivityState";
import type { SessionStateBadgeKind } from "./components/activityBadge";
import { sessionMatchesSearch } from "./sessionSearch";
import { CORE_SESSION_SECTIONS, compareRanked, modifiedMs, sectionOf, sessionRank, type SessionRank, type SessionRankCategory, type SessionSectionDefinition } from "./sessionOrder";

/**
 * Model for the mobile quick switcher.
 *
 * The navigation panel is an accordion of machines → projects → workspaces →
 * sessions, and on a phone only one section is open at a time. Reaching a
 * session therefore costs a chain of expand-and-tap steps, and starting one
 * costs the same chain before the "+" button is even reachable. The quick
 * switcher replaces that drill-down with a single flat surface: create at the
 * top, recent sessions grouped by age below, and workspaces inline so context
 * can change without unfolding anything.
 *
 * Everything here is pure so the ordering, grouping, and filtering rules are
 * testable without rendering the sheet.
 */

/** A section's id: core's (pinned, active, archived) or a plugin's. */
export type QuickSwitcherGroupId = string;

/** Filters applied before grouping; an empty filter is focus mode (everything). */
export interface QuickSwitcherFilter {
  machineId?: string;
  projectId?: string;
  workspacePath?: string;
}

export interface QuickSwitcherGroup {
  id: QuickSwitcherGroupId;
  title: string;
  sessions: SessionInfo[];
  foldedByDefault?: boolean;
  emptyText?: string;
}

export interface QuickSwitcherModelInput {
  sessions: readonly SessionInfo[];
  activeSessionIds: ReadonlySet<string>;
  /** Sessions whose agent stopped on an error (model unavailable, tool failure). */
  errorSessionIds?: ReadonlySet<string>;
  /** Sessions whose agent is blocked on an `ask_user` answer. */
  waitingSessionIds?: ReadonlySet<string>;
  /** Sessions that finished work the user has not looked at yet. */
  unreadSessionIds?: ReadonlySet<string>;
  /** Sessions whose run a restart cut off, from the daemon's interrupted record. */
  interruptedSessionIds?: ReadonlySet<string>;
  /** Sessions the user pinned. */
  pinnedSessionIds?: ReadonlySet<string>;
  query: string;
  /** The machine the rows belong to, for a plugin section's claim. */
  machineId?: string;
  /** Core's and the plugins' sections, in order; core's alone when absent. */
  sections?: readonly SessionSectionDefinition[];
  /** A session's last activity for ordering; the switcher's `ActivityClock`. The session file's time when absent. */
  activityAt?: (session: SessionInfo, rank: SessionRank) => number;
}

export interface QuickSwitcherModel {
  groups: QuickSwitcherGroup[];
  matchCount: number;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * The switcher's sections are every session list's (navigation-lists.md sections 4 and 5): Pinned,
 * Active, Archived and any a plugin adds, each ordered by what the session needs from the reader
 * (error, asking, unread, working, read), then by last activity. The attention groups and the
 * date groups this replaced ranked the same session differently from the Navigate page (B14
 * review item 9).
 */
export function quickSwitcherModel(input: QuickSwitcherModelInput): QuickSwitcherModel {
  const matches = input.sessions.filter((session) => sessionMatchesSearch(session, input.query));
  const definitions = input.sections ?? CORE_SESSION_SECTIONS;
  const pinned = input.pinnedSessionIds ?? EMPTY_IDS;
  const bySection = new Map<string, { session: SessionInfo; rank: SessionRank; at: number }[]>();
  for (const session of matches) {
    const archived = session.archived === true;
    const id = sectionOf({ sessionId: session.id, machineId: input.machineId ?? "", cwd: session.cwd, name: session.name, pinned: pinned.has(session.id), archived }, definitions);
    const rank = sessionRank({ category: switcherCategory(session.id, input), unread: (input.unreadSessionIds ?? EMPTY_IDS).has(session.id), interrupted: (input.interruptedSessionIds ?? EMPTY_IDS).has(session.id) });
    const at = input.activityAt?.(session, rank) ?? modifiedMs(session.modified);
    const list = bySection.get(id) ?? [];
    list.push({ session, rank, at });
    bySection.set(id, list);
  }
  const groups = definitions
    .map((definition) => ({ definition, ranked: (bySection.get(definition.id) ?? []).sort(compareRanked) }))
    .filter(({ definition, ranked }) => ranked.length > 0 || definition.emptyText !== undefined)
    .map(({ definition, ranked }) => ({
      id: definition.id,
      title: definition.title,
      sessions: ranked.map((entry) => entry.session),
      ...(definition.foldedByDefault === true ? { foldedByDefault: true } : {}),
      ...(definition.emptyText === undefined ? {} : { emptyText: definition.emptyText }),
    }));
  return { groups, matchCount: matches.length };
}

/** The switcher's state sets as the classifier's category, most urgent first. */
function switcherCategory(sessionId: string, input: QuickSwitcherModelInput): SessionRankCategory {
  if ((input.errorSessionIds ?? EMPTY_IDS).has(sessionId)) return "error";
  if ((input.waitingSessionIds ?? EMPTY_IDS).has(sessionId)) return "asking";
  if (input.activeSessionIds.has(sessionId)) return "working";
  return "idle";
}

/**
 * Narrow the session list to a chosen device, project or workspace before it is
 * grouped. An empty filter is focus mode: every session the switcher loaded,
 * across every workspace, so the default is breadth and narrowing is a choice.
 *
 * Project is matched through the workspaces that belong to it, since a session
 * knows its workspace path but not its project id.
 */
export function quickSwitcherFilterSessions(
  sessions: readonly SessionInfo[],
  filter: QuickSwitcherFilter,
  workspaces: readonly Workspace[],
): SessionInfo[] {
  // An empty set is the absence of an answer, not the answer "none". Workspaces
  // load per project, one request each, so a project picked before its response
  // lands has no known paths yet - and matching against nothing hid every
  // session, including the one the reader was sitting in.
  const knownPaths = new Set(
    workspaces.filter((workspace) => workspace.projectId === filter.projectId).map((workspace) => workspace.path),
  );
  const projectPaths = filter.projectId === undefined || knownPaths.size === 0 ? undefined : knownPaths;
  return sessions.filter((session) => {
    // A session whose folder is gone is not openable; the switcher offers
    // openable things.
    if (session.cwdMissing === true) return false;
    if (filter.workspacePath !== undefined && session.cwd !== filter.workspacePath) return false;
    if (projectPaths !== undefined && !projectPaths.has(session.cwd)) return false;
    return true;
  });
}

/** Whether any filter is set; false means focus mode (show everything). */
export function quickSwitcherFilterActive(filter: QuickSwitcherFilter): boolean {
  return filter.machineId !== undefined || filter.projectId !== undefined || filter.workspacePath !== undefined;
}

/**
 * Workspaces are offered as flat rows, filtered by the same query, so changing
 * context is one tap from the same surface rather than a separate section.
 */
export function quickSwitcherWorkspaces(workspaces: readonly Workspace[], query: string): Workspace[] {
  const tokens = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return [...workspaces];
  return workspaces.filter((workspace) => {
    const haystack = `${workspace.label}\n${workspace.path}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

export function quickSwitcherSessionSubtitle(session: SessionInfo, workspaces: readonly Workspace[]): string {
  const workspace = workspaces.find((candidate) => candidate.path === session.cwd);
  const messages = `${String(session.messageCount)} ${session.messageCount === 1 ? "message" : "messages"}`;
  return workspace === undefined ? messages : `${workspace.label} · ${messages}`;
}

/**
 * Apply a rename to a cached session list.
 *
 * The switcher holds its own copy of the sessions, loaded once and reused, so a
 * rename made anywhere else leaves it showing the previous name -- which is the
 * name the user renamed away from, usually because it was unrecognisable.
 *
 * Returns the original array when nothing matched, so an unrelated rename does
 * not invalidate a rendered list.
 */
export function renameSessionInList(
  sessions: readonly SessionInfo[],
  sessionId: string,
  name: string,
): readonly SessionInfo[] {
  if (!sessions.some((session) => session.id === sessionId)) return sessions;
  return sessions.map((session) => (session.id === sessionId ? { ...session, name } : session));
}

/**
 * Four-state work badges for exactly the sessions the switcher lists.
 *
 * The switcher is machine-wide: it lists recent sessions from every workspace,
 * while the app's selected workspace only knows its own. Computing the badges
 * from `state.sessions` would leave cross-workspace sessions without a state -
 * and the fallback in the row renderer would paint an active session with the
 * idle dot it happens to share, which is how a working session came to read as
 * a green dot. Deriving from the list being rendered keeps group placement and
 * badge color from the same source, so WORKING and three dots cannot diverge.
 */
export function quickSwitcherSessionStates(
  sessions: readonly SessionInfo[],
  statuses: Readonly<Record<string, SessionStatus>>,
  activities: Readonly<Record<string, SessionActivity>>,
): ReadonlyMap<string, SessionStateBadgeKind> {
  const kinds = new Map<string, SessionStateBadgeKind>();
  for (const session of sessions) {
    const kind = sessionActivityCategory(statuses[session.id], activities[session.id]);
    if (kind !== undefined) kinds.set(session.id, kind);
  }
  return kinds;
}

/** The sessions in one category of the map, for a group or section built from the classifier (B14). */
export function sessionIdsIn(states: ReadonlyMap<string, SessionStateBadgeKind>, category: SessionStateBadgeKind): ReadonlySet<string> {
  return new Set([...states].flatMap(([sessionId, kind]) => (kind === category ? [sessionId] : [])));
}
