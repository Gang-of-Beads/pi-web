import type { SessionActivityCategory } from "../../shared/sessionActivityState";

/**
 * How every list of sessions is sectioned and ordered (owner, 2026-10-04; navigation-lists.md
 * sections 4 and 5). One module so the Navigate page, the session search and any later list agree:
 * the same session sits in the same section at the same rank everywhere.
 *
 * Sections: a session lands in the first section, by `order`, that claims it. Core owns Pinned,
 * Active and Archived; a plugin may add its own between them.
 *
 * Order inside a section: rank first (what the reader has to do), then the newest last activity.
 * A running session's activity time is frozen while it runs, so streaming does not reshuffle the
 * list; it moves once, when the run ends.
 */

/** What a session asks of the reader, most urgent first. */
export type SessionRank = "error" | "asking" | "unread" | "working" | "read";

const RANK_POSITION: Readonly<Record<SessionRank, number>> = {
  error: 0,
  asking: 1,
  unread: 2,
  working: 3,
  read: 4,
};

/** The classifier's category before the unread flag is known; `unknown` is a state not yet read. */
export type SessionRankCategory = SessionActivityCategory | "unknown";

/** Each category's rank; only an idle (or not yet known) session splits on unread. */
const CATEGORY_RANK: Readonly<Record<SessionRankCategory, (unread: boolean) => SessionRank>> = {
  error: () => "error",
  asking: () => "asking",
  working: () => "working",
  background: () => "working",
  idle: (unread) => unread ? "unread" : "read",
  unknown: (unread) => unread ? "unread" : "read",
};

export interface SessionRankInput {
  readonly category: SessionRankCategory;
  readonly unread: boolean;
  /** A run a restart cut off and nothing has picked up again: it needs the reader like an error. */
  readonly interrupted: boolean;
}

export function sessionRank(input: SessionRankInput): SessionRank {
  const rank = CATEGORY_RANK[input.category](input.unread);
  return input.interrupted && rank !== "working" ? "error" : rank;
}

/** What a section's claim sees of a session. */
export interface SessionSectionSubject {
  readonly sessionId: string;
  readonly machineId: string;
  readonly cwd: string;
  readonly name: string | undefined;
  readonly pinned: boolean;
  readonly archived: boolean;
}

export interface SessionSectionDefinition {
  readonly id: string;
  readonly title: string;
  /** Where the section sits: Pinned 100, Active 500, Archived 900. */
  readonly order: number;
  /** Folded until the reader opens it, the first time a list shows it. */
  readonly foldedByDefault?: boolean;
  /** Shown even with no session in it, saying so (Archived: "Nothing archived yet"). */
  readonly emptyText?: string;
  readonly claims: (subject: SessionSectionSubject) => boolean;
}

export const CORE_SESSION_SECTIONS: readonly SessionSectionDefinition[] = [
  { id: "pinned", title: "Pinned", order: 100, claims: (subject) => subject.pinned && !subject.archived },
  { id: "active", title: "Active", order: 500, claims: (subject) => !subject.archived },
  { id: "archived", title: "Archived", order: 900, foldedByDefault: true, emptyText: "Nothing archived yet", claims: (subject) => subject.archived },
];

/** Core's sections with the contributed ones, in order; a contribution never replaces a core id. */
export function sessionSections(contributed: readonly SessionSectionDefinition[]): SessionSectionDefinition[] {
  const coreIds = new Set(CORE_SESSION_SECTIONS.map((section) => section.id));
  return [...CORE_SESSION_SECTIONS, ...contributed.filter((section) => !coreIds.has(section.id))]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

/** The section a session lands in: the first, by order, that claims it. A claim that throws claims nothing. */
export function sectionOf(subject: SessionSectionSubject, sections: readonly SessionSectionDefinition[]): string {
  for (const section of sections) {
    if (claimsSafely(section, subject)) return section.id;
  }
  return subject.archived ? "archived" : "active";
}

function claimsSafely(section: SessionSectionDefinition, subject: SessionSectionSubject): boolean {
  try {
    return section.claims(subject);
  } catch {
    return false;
  }
}

export interface RankedSession {
  readonly rank: SessionRank;
  /** Last activity, ms since the epoch; see `ActivityClock`. */
  readonly at: number;
}

/** Rank first, then the newest last activity. */
export function compareRanked(left: RankedSession, right: RankedSession): number {
  return RANK_POSITION[left.rank] - RANK_POSITION[right.rank] || right.at - left.at;
}

/**
 * A session's last activity for ordering. The session file's modified time moves on every entry a
 * run writes, so while a session works its time is held at the moment it was first seen working
 * (about when its run began); once the run ends the file's time, which is then the run's end, is
 * used again. One instance per list, so the hold survives that list's re-renders.
 */
export class ActivityClock {
  private readonly held = new Map<string, number>();

  timeOf(key: string, rank: SessionRank, modifiedMs: number): number {
    if (rank !== "working") {
      this.held.delete(key);
      return modifiedMs;
    }
    const held = this.held.get(key);
    if (held !== undefined) return held;
    this.held.set(key, modifiedMs);
    return modifiedMs;
  }
}

export function modifiedMs(modified: string): number {
  const parsed = Date.parse(modified);
  return Number.isNaN(parsed) ? 0 : parsed;
}
