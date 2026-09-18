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

import type { SessionInfo } from "./api";

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
  /** Sessions known to live under this choice, when the caller knows. */
  sessionCount?: number;
}

export interface NavigateSessionRow {
  session: SessionInfo;
  machineId: string;
  pinned: boolean;
  /** Whether this row is the session currently open. */
  current: boolean;
  /** Derived tags: project, folder, machine, state. Searchable with `#`, not shown. */
  tags: string[];
  /** One quiet line under the name: what it is doing, how big, where it runs. */
  detail: string;
}

export interface NavigateSection {
  id: "pinned" | "waiting" | "running" | "recent" | "choices";
  title: string;
  rows: NavigateSessionRow[];
  choices: NavigateChoice[];
}

export interface NavigateModel {
  /** The level the next choice list belongs to, or undefined at a folder. */
  nextLevel: NavigateLevel | undefined;
  sections: NavigateSection[];
  matchCount: number;
}

interface MachineLike { id: string; name: string }
interface ProjectLike { id: string; name: string; path?: string }
interface FolderLike { id: string; label: string; path: string; projectId?: string }

export interface NavigateInput {
  scope: NavigateScope;
  machines: readonly MachineLike[];
  projects: readonly ProjectLike[];
  folders: readonly FolderLike[];
  /** Sessions on the browsed machine. */
  sessions: readonly SessionInfo[];
  /** Pinned sessions from every machine, each carrying the machine it belongs to. */
  pinned: readonly { session: SessionInfo; machineId: string }[];
  waitingSessionIds: ReadonlySet<string>;
  activeSessionIds: ReadonlySet<string>;
  pinnedSessionIds: ReadonlySet<string>;
  query: string;
  /** Manual tags per session id, merged with the derived ones. */
  manualTags?: Readonly<Record<string, readonly string[]>>;
}

export function navigateModel(input: NavigateInput): NavigateModel {
  const nextLevel = nextLevelFor(input);
  const scoped = input.sessions.filter((session) => inScope(session, input));
  const rows = scoped
    .filter((session) => session.archived !== true)
    .map((session) => row(session, input.scope.machineId, input));
  const matching = rows.filter((entry) => matches(entry, input.query));

  const sections: NavigateSection[] = [];
  const pinnedRows = pinnedSection(input).filter((entry) => matches(entry, input.query));
  if (pinnedRows.length > 0) sections.push({ id: "pinned", title: "Pinned", rows: pinnedRows, choices: [] });

  const waiting = matching.filter((entry) => input.waitingSessionIds.has(entry.session.id));
  if (waiting.length > 0) sections.push({ id: "waiting", title: "Waiting for you", rows: waiting, choices: [] });

  const running = matching.filter((entry) => input.activeSessionIds.has(entry.session.id) && !input.waitingSessionIds.has(entry.session.id));
  if (running.length > 0) sections.push({ id: "running", title: "Working", rows: running, choices: [] });

  const rest = matching.filter((entry) => !waiting.includes(entry) && !running.includes(entry) && !entry.pinned);
  if (rest.length > 0) sections.push({ id: "recent", title: "Recent", rows: rest, choices: [] });

  const choices = choicesFor(nextLevel, input);
  if (choices.length > 0) sections.push({ id: "choices", title: choiceTitle(nextLevel), rows: [], choices });

  return { nextLevel, sections, matchCount: matching.length + pinnedRows.length };
}

/** The tags a session carries without anyone typing one. */
export function derivedTags(session: SessionInfo, input: Pick<NavigateInput, "projects" | "folders" | "machines" | "waitingSessionIds" | "activeSessionIds" | "pinnedSessionIds">, machineId: string): string[] {
  const tags: string[] = [];
  const machine = input.machines.find((entry) => entry.id === machineId);
  if (machine !== undefined) tags.push(machine.name);
  const folder = input.folders.find((entry) => entry.path === session.cwd);
  if (folder !== undefined) {
    tags.push(folder.label);
    const project = input.projects.find((entry) => entry.id === folder.projectId);
    if (project !== undefined) tags.push(project.name);
  }
  if (input.waitingSessionIds.has(session.id)) tags.push("waiting");
  else if (input.activeSessionIds.has(session.id)) tags.push("running");
  if (input.pinnedSessionIds.has(session.id)) tags.push("pinned");
  return [...new Set(tags.map((tag) => tag.toLowerCase()))];
}

function row(session: SessionInfo, machineId: string, input: NavigateInput): NavigateSessionRow {
  const manual = input.manualTags?.[session.id] ?? [];
  return {
    session,
    machineId,
    pinned: input.pinnedSessionIds.has(session.id),
    current: machineId === input.scope.machineId && session.id === input.scope.sessionId,
    tags: [...new Set([...derivedTags(session, input, machineId), ...manual.map((tag) => tag.toLowerCase())])],
    detail: sessionDetail(session, machineId, input),
  };
}

/**
 * The subtitle a reader can use: state first because it decides whether to
 * open, then size, then the folder it runs in. Tags stay searchable but off
 * the screen - a row of hashes said nothing at a glance (owner).
 */
function sessionDetail(session: SessionInfo, machineId: string, input: NavigateInput): string {
  const parts: string[] = [];
  if (input.waitingSessionIds.has(session.id)) parts.push("waiting for you");
  else if (input.activeSessionIds.has(session.id)) parts.push("working");
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

function pinnedSection(input: NavigateInput): NavigateSessionRow[] {
  return input.pinned.map((entry) => row(entry.session, entry.machineId, input));
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
  return input.projects.map((project) => ({
    level,
    id: project.id,
    label: project.name,
    ...(project.path === undefined ? {} : { detail: project.path }),
    current: project.id === input.scope.projectId,
  }));
}

function choiceTitle(level: NavigateLevel | undefined): string {
  return level === "machine" ? "Machines" : "Projects";
}
