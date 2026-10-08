/**
 * What the one navigation surface shows.
 *
 * Four surfaces used to answer "where am I and where can I go": a context
 * sheet of projects, a quick-access menu of sessions, the navigation panel's
 * accordion, and the Go to sheet. Each one navigated away from the others, so
 * the reader could arrive somewhere with no way back. This model says the
 * whole answer in one shape: a path the reader is standing on, the choices
 * available at the level below it, and the sessions in scope. Callers render
 * it; nothing here knows about elements.
 *
 * The path is the only navigation: widening a level is how you go back, so
 * there is no screen to return from.
 */

import { presentProjectsFirst, projectDetail, projectFolderFlag } from "./projectFolder";
import { CORE_SESSION_SECTIONS, compareRanked, modifiedMs, sectionOf, sessionRank, type SectionOrdering, type SessionRank, type SessionSectionDefinition } from "./sessionOrder";
import type { SessionInfo } from "./api";
import type { SessionActivityCategory } from "../../shared/sessionActivityState";

/**
 * The levels a reader navigates. There is no folder level: the owner could not
 * tell a project from a folder, because a project with no worktrees prints the
 * same name twice and a folder is an implementation of where a checkout lives.
 * Sessions are listed for the whole project; which folder one runs in is a
 * property of that session, not a place to stand.
 */
export type NavigateLevel = "machine" | "project";

export interface NavigateScope {
  machineId: string;
  /** The session being read, so the list can mark where the reader already is. */
  sessionId: string | undefined;
  projectId: string | undefined;
  folderPath: string | undefined;
}

export interface NavigateChoice {
  level: NavigateLevel;
  id: string;
  label: string;
  detail?: string;
  current: boolean;
  /** A project whose folder is gone, drawn greyed and listed last (`projectFolder.ts`). */
  folderMissing?: true;
  /** Sessions known to live under this choice, when the caller knows. */
  sessionCount?: number;
}

export interface SessionPinFacts {
  readonly global: boolean;
  readonly project: boolean | undefined;
}

/** The mark beside a session's name: its category from the one classifier (B14), or unknown before its state is known. */
export type NavigateSessionState = SessionActivityCategory | "unknown";

export interface NavigateSessionRow {
  session: SessionInfo;
  machineId: string;
  /** Whether the row sits under PINNED on this board; see `shownPinned`. */
  pinned: boolean;
  /** Its global pin, and its pin in the project the board stands in (undefined where there is none to set). */
  pins: SessionPinFacts;
  /** Whether this row is the session currently open. */
  current: boolean;
  /** Derived tags: project, folder, machine, state. Searchable with `#`, not shown. */
  tags: string[];
  /** One quiet line under the name: what it is doing, how big, where it runs. */
  detail: string;
  /** Where the session lives, for the line under its name. */
  path: string;
  /** What the session is doing right now, for the mark beside its name. */
  state: NavigateSessionState;
}

export interface NavigateSection {
  /** A session section's id (core: pinned, active, archived; or a plugin's), or "choices". */
  id: string;
  title: string;
  rows: NavigateSessionRow[];
  choices: NavigateChoice[];
  foldedByDefault?: boolean;
  emptyText?: string;
  /** How the rows are ordered; a pin-ordered section is the one a reader can drag (R11). */
  ordering?: SectionOrdering;
}

export interface NavigateModel {
  /** The level the next choice list belongs to, or undefined at a folder. */
  nextLevel: NavigateLevel | undefined;
  sections: NavigateSection[];
  matchCount: number;
}

interface MachineLike { id: string; name: string }
interface ProjectLike { id: string; name: string; path?: string; folderMissing?: boolean }
interface FolderLike { id: string; label: string; path: string; projectId?: string }

export interface NavigateInput {
  scope: NavigateScope;
  machines: readonly MachineLike[];
  projects: readonly ProjectLike[];
  folders: readonly FolderLike[];
  /** Sessions on the browsed machine. */
  sessions: readonly SessionInfo[];
  /** Globally pinned sessions, each carrying the machine it belongs to; a project's own pins come from `sessions`. */
  pinned: readonly { session: SessionInfo; machineId: string }[];
  /** Each session's category from `sessionActivityCategory`; a session missing from it is unknown. */
  sessionStates: ReadonlyMap<string, SessionActivityCategory>;
  /** The machine's global pins. */
  pinnedSessionIds: ReadonlySet<string>;
  /** The scoped project's pins (B49); undefined with no project in scope or a machine that keeps none. */
  projectPinnedSessionIds?: ReadonlySet<string> | undefined;
  query: string;
  /** Manual tags per session id, merged with the derived ones. */
  manualTags?: Readonly<Record<string, readonly string[]>>;
  /** Sessions with a finished reply the reader has not seen. */
  unreadSessionIds?: ReadonlySet<string>;
  /** The open session, ranked as still unread while its row holds its place (`openRowHold.ts`). */
  heldOpenSessionId?: string | undefined;
  /** Sessions whose run a restart cut off. */
  interruptedSessionIds?: ReadonlySet<string>;
  /** Core's and the plugins' sections, in order; core's alone when absent. */
  sections?: readonly SessionSectionDefinition[];
  /** A row's last activity for ordering; the page's `ActivityClock`. The session file's time when absent. */
  activityAt?: (row: NavigateSessionRow, rank: SessionRank) => number;
}

export function navigateModel(input: NavigateInput): NavigateModel {
  const nextLevel = nextLevelFor(input);
  const scoped = input.sessions.filter((session) => inScope(session, input));
  const rows = scoped
    .filter((session) => session.archived !== true)
    .map((session) => row(session, input.scope.machineId, input));
  const archivedRows = scoped
    .filter((session) => session.archived === true)
    .map((session) => row(session, input.scope.machineId, input))
    .filter((entry) => matches(entry, input.query));
  const matching = rows.filter((entry) => matches(entry, input.query));

  const pinnedRows = pinnedSection(input).filter((entry) => matches(entry, input.query));
  // One session, one row: a pinned session is listed once, from the pins, wherever its
  // state would otherwise put it.
  const unpinned = matching.filter((entry) => !entry.pinned);
  const sections: NavigateSection[] = sessionSectionsFor([...pinnedRows, ...unpinned, ...archivedRows], input);

  // Every level's choices, not just the next one: the page lists one kind at a
  // time, and asking for Machines while standing in a project used to answer
  // "Nothing to choose at this level" with machines sitting right there.
  for (const level of ["machine", "project"] as const) {
    const choices = choicesFor(level, input);
    if (choices.length > 0) sections.push({ id: "choices", title: choiceTitle(level), rows: [], choices });
  }

  return { nextLevel, sections, matchCount: matching.length + pinnedRows.length };
}

/**
 * Every session row into its section, each section in rank-then-activity order (navigation-lists.md
 * sections 4 and 5). A section with nothing in it is left out, except one that says so when empty
 * (Archived). Archived rows are not matches: the empty state speaks about the sessions a reader
 * works in.
 */
function sessionSectionsFor(rows: readonly NavigateSessionRow[], input: NavigateInput): NavigateSection[] {
  const definitions = input.sections ?? CORE_SESSION_SECTIONS;
  const seen = new Set<string>();
  const bySection = new Map<string, { row: NavigateSessionRow; rank: SessionRank; at: number }[]>();
  for (const entry of rows) {
    const key = `${entry.machineId}:${entry.session.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const archived = entry.session.archived === true;
    const id = sectionOf({ sessionId: entry.session.id, machineId: entry.machineId, cwd: entry.session.cwd, name: entry.session.name, pinned: entry.pinned, archived }, definitions);
    const rank = sessionRank({ category: entry.state, unread: input.unreadSessionIds?.has(entry.session.id) === true || input.heldOpenSessionId === entry.session.id, interrupted: input.interruptedSessionIds?.has(entry.session.id) === true });
    const at = input.activityAt?.(entry, rank) ?? modifiedMs(entry.session.modified);
    const list = bySection.get(id) ?? [];
    list.push({ row: entry, rank, at });
    bySection.set(id, list);
  }
  const compare = sectionComparators(input);
  return definitions
    .map((definition) => ({ definition, ranked: (bySection.get(definition.id) ?? []).sort(compare[definition.ordering ?? "activity"]) }))
    .filter(({ definition, ranked }) => ranked.length > 0 || definition.emptyText !== undefined)
    .map(({ definition, ranked }) => ({
      id: definition.id,
      title: definition.title,
      rows: ranked.map((entry) => entry.row),
      choices: [],
      ...(definition.foldedByDefault === true ? { foldedByDefault: true } : {}),
      ...(definition.ordering === undefined ? {} : { ordering: definition.ordering }),
      ...(definition.emptyText === undefined ? {} : { emptyText: definition.emptyText }),
    }));
}

interface SectionEntry {
  readonly row: NavigateSessionRow;
  readonly rank: SessionRank;
  readonly at: number;
}

/**
 * One comparator per ordering. "pins" follows the pin list the Pinned section shows: the scoped
 * project's own pins in a project, the machine's global pins on the machine-wide list (B49); a
 * pinned row that list does not hold (one pinned on another machine) follows, by rank and activity.
 */
function sectionComparators(input: NavigateInput): Readonly<Record<SectionOrdering, (left: SectionEntry, right: SectionEntry) => number>> {
  const pins = [...((input.scope.projectId === undefined ? undefined : input.projectPinnedSessionIds) ?? input.pinnedSessionIds)];
  const place = new Map(pins.map((id, index) => [`${input.scope.machineId}:${id}`, index]));
  const placeOf = (entry: SectionEntry) => place.get(`${entry.row.machineId}:${entry.row.session.id}`) ?? pins.length;
  return {
    activity: compareRanked,
    pins: (left, right) => placeOf(left) - placeOf(right) || compareRanked(left, right),
  };
}

/** The tags a session carries without anyone typing one. */
export function derivedTags(session: SessionInfo, input: Pick<NavigateInput, "projects" | "folders" | "machines" | "sessionStates" | "pinnedSessionIds">, machineId: string): string[] {
  const tags: string[] = [];
  const machine = input.machines.find((entry) => entry.id === machineId);
  if (machine !== undefined) tags.push(machine.name);
  const folder = input.folders.find((entry) => entry.path === session.cwd);
  if (folder !== undefined) {
    tags.push(folder.label);
    const project = input.projects.find((entry) => entry.id === folder.projectId);
    if (project !== undefined) tags.push(project.name);
  }
  const stateTag = STATE_TAG[input.sessionStates.get(session.id) ?? "unknown"];
  if (stateTag !== undefined) tags.push(stateTag);
  if (input.pinnedSessionIds.has(session.id)) tags.push("pinned");
  return [...new Set(tags.map((tag) => tag.toLowerCase()))];
}

/** The searchable tag each state carries, where it carries one. */
const STATE_TAG: Readonly<Record<NavigateSessionState, string | undefined>> = {
  asking: "waiting",
  working: "running",
  background: undefined,
  error: undefined,
  idle: undefined,
  unknown: undefined,
};

/** The word each state puts first under a session's name, where it says one. */
const STATE_DETAIL: Readonly<Record<NavigateSessionState, string | undefined>> = {
  asking: "waiting for you",
  working: "working",
  background: undefined,
  error: undefined,
  idle: undefined,
  unknown: undefined,
};

/**
 * A list of names alone could not say which session was working and which was
 * waiting for an answer, which is what a reader scans for. The state is the
 * classifier's, as on every other surface (B14): the page used to derive
 * waiting, working and idle on its own, so a failed session read idle here and
 * error in the switcher.
 */
function sessionState(session: SessionInfo, input: NavigateInput): NavigateSessionState {
  return input.sessionStates.get(session.id) ?? "unknown";
}

function row(session: SessionInfo, machineId: string, input: NavigateInput): NavigateSessionRow {
  const manual = input.manualTags?.[session.id] ?? [];
  const pins = pinFacts(session.id, input);
  return {
    session,
    machineId,
    pinned: shownPinned(pins),
    pins,
    current: machineId === input.scope.machineId && session.id === input.scope.sessionId,
    tags: [...new Set([...derivedTags(session, input, machineId), ...manual.map((tag) => tag.toLowerCase())])],
    detail: sessionDetail(session, machineId, input),
    path: sessionPath(session, input),
    state: sessionState(session, input),
  };
}

/**
 * The subtitle a reader can use: state first because it decides whether to
 * open, then size, then the folder it runs in. Tags stay searchable but off
 * the screen - a row of hashes said nothing at a glance (owner).
 */
/**
 * The project a session runs in, or its working directory when the project is
 * not in the loaded catalogue. The owner reads a list of names by where they
 * are, so the row says where before it says how busy.
 */
function sessionPath(session: SessionInfo, input: NavigateInput): string {
  const folder = input.folders.find((entry) => entry.path === session.cwd);
  const project = folder === undefined ? undefined : input.projects.find((entry) => entry.id === folder.projectId);
  return project?.name ?? folder?.label ?? session.cwd;
}

function sessionDetail(session: SessionInfo, machineId: string, input: NavigateInput): string {
  const parts: string[] = [];
  const stateWord = STATE_DETAIL[sessionState(session, input)];
  if (stateWord !== undefined) parts.push(stateWord);
  const count = session.messageCount;
  if (typeof count === "number" && count > 0) parts.push(count === 1 ? "1 message" : `${String(count)} messages`);
  const folder = input.folders.find((entry) => entry.path === session.cwd);
  if (folder !== undefined) parts.push(folder.label);
  else if (machineId !== input.scope.machineId) {
    const machine = input.machines.find((entry) => entry.id === machineId);
    if (machine !== undefined) parts.push(machine.name);
  }
  return parts.join(" · ");
}

/**
 * Pins obey the path, because the path is the only scope control on this
 * board: a narrowed path lists only the pins it contains (the owner's report of
 * another project's pins under a project title). Which pin counts is `shownPinned`'s
 * rule (B49): on the machine-wide board PINNED lists global pins; with a project in
 * scope it lists only that project's own pins, unless the machine keeps no project
 * pins, in which case the global pins still apply.
 */
function pinnedSection(input: NavigateInput): NavigateSessionRow[] {
  const projectPins = input.scope.projectId === undefined ? undefined : input.projectPinnedSessionIds;
  if (projectPins === undefined) {
    return input.pinned
      .filter((entry) => inScope(entry.session, input))
      .map((entry) => globallyPinned(row(entry.session, entry.machineId, input)))
      .filter((entry) => entry.pinned);
  }
  return input.sessions
    .filter((session) => inScope(session, input) && projectPins.has(session.id))
    .map((session) => row(session, input.scope.machineId, input));
}

/** An entry of `pinned` is pinned globally by the caller's word, whatever the id set says. */
function globallyPinned(entry: NavigateSessionRow): NavigateSessionRow {
  const pins = { ...entry.pins, global: true };
  return { ...entry, pins, pinned: shownPinned(pins) };
}

function pinFacts(sessionId: string, input: NavigateInput): SessionPinFacts {
  const project = input.scope.projectId === undefined ? undefined : input.projectPinnedSessionIds?.has(sessionId);
  return { global: input.pinnedSessionIds.has(sessionId), project };
}

/**
 * Which pin puts a row under PINNED (B49). Owner, 2026-10-08 (ask 9dcf07fa): "global is the
 * global pin, project is the project pin; the menu chooses where to pin". So the machine-wide board
 * lists global pins, and a project lists only its own; a global pin sits in a project's list like
 * any session. A machine that keeps no project pins has only the global pin, in a project too.
 */
function shownPinned(pins: SessionPinFacts): boolean {
  return pins.project ?? pins.global;
}

function inScope(session: SessionInfo, input: NavigateInput): boolean {
  if (input.scope.projectId === undefined) return true;
  const paths = input.folders.filter((folder) => folder.projectId === input.scope.projectId).map((folder) => folder.path);
  // An unloaded folder list is the absence of an answer, not "no folders":
  // filtering against nothing would hide every session including the open one.
  if (paths.length === 0) return true;
  return paths.includes(session.cwd);
}

function matches(entry: NavigateSessionRow, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") return true;
  const terms = trimmed.split(/\s+/u);
  return terms.every((term) => {
    if (term.startsWith("#")) return entry.tags.some((tag) => tag.includes(term.slice(1)));
    const haystack = [entry.session.name ?? "", entry.session.cwd, ...entry.tags].join("\n").toLowerCase();
    return haystack.includes(term);
  });
}

function nextLevelFor(input: NavigateInput): NavigateLevel | undefined {
  return input.projects.length === 0 && input.machines.length > 1 ? "machine" : "project";
}

function choicesFor(level: NavigateLevel | undefined, input: NavigateInput): NavigateChoice[] {
  if (level === undefined) return [];
  if (level === "machine") {
    return input.machines.map((machine) => ({ level, id: machine.id, label: machine.name, current: machine.id === input.scope.machineId }));
  }
  return presentProjectsFirst(input.projects).map((project) => {
    const detail = projectDetail(project);
    return {
      level,
      id: project.id,
      label: project.name,
      ...(detail === undefined ? {} : { detail }),
      current: project.id === input.scope.projectId,
      ...projectFolderFlag(project),
    };
  });
}

function choiceTitle(level: NavigateLevel | undefined): string {
  return level === "machine" ? "Machines" : "Projects";
}
