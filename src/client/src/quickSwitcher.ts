import type { SessionInfo, Workspace } from "./api";
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

export type QuickSwitcherGroupId = "waiting" | "active" | "unread" | "today" | "yesterday" | "earlier";

export interface QuickSwitcherGroup {
  id: QuickSwitcherGroupId;
  title: string;
  sessions: SessionInfo[];
}

export interface QuickSwitcherModelInput {
  sessions: readonly SessionInfo[];
  activeSessionIds: ReadonlySet<string>;
  /** Sessions whose agent is blocked on an `ask_user` answer. */
  waitingSessionIds?: ReadonlySet<string>;
  /** Sessions that finished work the user has not looked at yet. */
  unreadSessionIds?: ReadonlySet<string>;
  query: string;
  now: number;
}

export interface QuickSwitcherModel {
  groups: QuickSwitcherGroup[];
  matchCount: number;
}

/**
 * Groups in the order they are shown, which is the order of how much they want
 * the user: an agent blocked on a question cannot progress at all without them,
 * work in flight may still need them, finished-but-unseen work is the reason
 * they opened the switcher, and everything else is plain recency.
 */
const GROUP_ORDER = ["waiting", "active", "unread", "today", "yesterday", "earlier"] as const;

const GROUP_TITLES: Record<QuickSwitcherGroupId, string> = {
  waiting: "Waiting for you",
  active: "Working",
  unread: "Finished",
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
    const groupId = quickSwitcherGroupId(
      session,
      input.activeSessionIds,
      input.waitingSessionIds ?? EMPTY_IDS,
      input.unreadSessionIds ?? EMPTY_IDS,
      input.now,
    );
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
function quickSwitcherGroupId(
  session: SessionInfo,
  activeSessionIds: ReadonlySet<string>,
  waitingSessionIds: ReadonlySet<string>,
  unreadSessionIds: ReadonlySet<string>,
  now: number,
): QuickSwitcherGroupId {
  if (waitingSessionIds.has(session.id)) return "waiting";
  if (activeSessionIds.has(session.id)) return "active";
  if (unreadSessionIds.has(session.id)) return "unread";
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
