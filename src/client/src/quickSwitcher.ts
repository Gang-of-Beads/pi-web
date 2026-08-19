import type { SessionActivity, SessionInfo, SessionStatus, Workspace } from "./api";
import { sessionActivityCategory } from "../../shared/sessionActivityState";
import type { SessionStateBadgeKind } from "./components/activityBadge";
import { sessionMatchesSearch } from "./sessionSearch";

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

export type QuickSwitcherGroupId = "error" | "waiting" | "interrupted" | "active" | "unread" | "pinned" | "today" | "yesterday" | "earlier";

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
  /** Sessions the user pinned, kept above plain recency. */
  pinnedSessionIds?: ReadonlySet<string>;
  query: string;
  now: number;
}

export interface QuickSwitcherModel {
  groups: QuickSwitcherGroup[];
  matchCount: number;
}

/**
 * Groups in the order they are shown, which is the order of how much they want
 * the user: an agent that errored is stuck until someone looks, one blocked on
 * a question cannot progress without an answer, a cut-off run will never finish
 * on its own, work in flight may still need them, finished-but-unseen work is
 * the reason they opened the switcher, a pinned session is one they chose to
 * keep close, and everything else is plain recency.
 */
const GROUP_ORDER = ["error", "waiting", "interrupted", "active", "unread", "pinned", "today", "yesterday", "earlier"] as const;

const GROUP_TITLES: Record<QuickSwitcherGroupId, string> = {
  error: "Needs attention",
  waiting: "Waiting for you",
  interrupted: "Interrupted",
  active: "Working",
  unread: "Finished",
  pinned: "Pinned",
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};

const DAY_MS = 24 * 60 * 60 * 1000;

const EMPTY_IDS: ReadonlySet<string> = new Set();

export function quickSwitcherModel(input: QuickSwitcherModelInput): QuickSwitcherModel {
  const matches = input.sessions
    .filter((session) => session.archived !== true)
    .filter((session) => sessionMatchesSearch(session, input.query));

  const byGroup = new Map<QuickSwitcherGroupId, SessionInfo[]>();
  for (const session of matches) {
    const groupId = quickSwitcherGroupId(session, {
      active: input.activeSessionIds,
      error: input.errorSessionIds ?? EMPTY_IDS,
      waiting: input.waitingSessionIds ?? EMPTY_IDS,
      unread: input.unreadSessionIds ?? EMPTY_IDS,
      interrupted: input.interruptedSessionIds ?? EMPTY_IDS,
      pinned: input.pinnedSessionIds ?? EMPTY_IDS,
    }, input.now);
    const group = byGroup.get(groupId) ?? [];
    group.push(session);
    byGroup.set(groupId, group);
  }

  const groups: QuickSwitcherGroup[] = [];
  for (const id of GROUP_ORDER) {
    const sessions = byGroup.get(id);
    if (sessions === undefined || sessions.length === 0) continue;
    groups.push({ id, title: GROUP_TITLES[id], sessions: sessions.sort(byMostRecentlyModified) });
  }

  return { groups, matchCount: matches.length };
}

/**
 * Attention beats recency: a session that needs the user is promoted above
 * every date group no matter when it was last modified. Within that, being
 * blocked on a question outranks still running, which outranks finished work
 * the user has not read.
 */
interface SessionStateSets {
  active: ReadonlySet<string>;
  error: ReadonlySet<string>;
  waiting: ReadonlySet<string>;
  unread: ReadonlySet<string>;
  interrupted: ReadonlySet<string>;
  pinned: ReadonlySet<string>;
}

function quickSwitcherGroupId(session: SessionInfo, sets: SessionStateSets, now: number): QuickSwitcherGroupId {
  // An error stops the agent until someone intervenes, so it outranks even a
  // question the user could answer to keep going.
  if (sets.error.has(session.id)) return "error";
  if (sets.waiting.has(session.id)) return "waiting";
  // Only while it is still stopped: a session that has been picked up again is
  // reported by what it is doing now, not by what a past restart did to it.
  if (sets.interrupted.has(session.id) && !sets.active.has(session.id)) return "interrupted";
  if (sets.active.has(session.id)) return "active";
  if (sets.unread.has(session.id)) return "unread";
  // A pin is a floor, not a ceiling: it lifts an otherwise-idle session above
  // plain recency, but never hides that the same session needs attention.
  if (sets.pinned.has(session.id)) return "pinned";
  const modified = Date.parse(session.modified);
  if (Number.isNaN(modified)) return "earlier";
  const age = now - modified;
  if (age < DAY_MS) return "today";
  if (age < 2 * DAY_MS) return "yesterday";
  return "earlier";
}

function byMostRecentlyModified(first: SessionInfo, second: SessionInfo): number {
  return sortableTimestamp(second.modified) - sortableTimestamp(first.modified);
}

function sortableTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
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
  const projectPaths = filter.projectId === undefined
    ? undefined
    : new Set(workspaces.filter((workspace) => workspace.projectId === filter.projectId).map((workspace) => workspace.path));
  return sessions.filter((session) => {
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
