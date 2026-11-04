import type { Project } from "./apiTypes.js";
import { isRecord } from "./unknownValues.js";

/**
 * Renaming a project renames its folder (owner, 2026-11-04): the project's name is the folder's
 * name, so there is one name to change and nothing for the two to disagree about. The folder keeps
 * its parent; only the last part of the path changes.
 */
export const PROJECT_RENAME_REQUEST_BODY_MAX_BYTES = 4 * 1024;

/** The longest folder name the request carries; the daemon still asks its file system. */
export const PROJECT_RENAME_NAME_MAX_LENGTH = 255;

/**
 * How long a browser waits for a rename. Every session file of the project is rewritten (its
 * header names the folder), which is seconds for most projects and can be minutes for a large one
 * on a phone; the daemon finishes or puts everything back whoever is still waiting.
 */
export const PROJECT_RENAME_TIMEOUT_MS = 5 * 60_000;

/**
 * How long each hop nearer the daemon waits: longer than the one before it, so the deadline a slow
 * rename meets is the browser's own, which says the outcome is not known yet. A hop that gave up
 * first would answer that the machine is unreachable while its rename runs on.
 */
export const PROJECT_RENAME_GATEWAY_TIMEOUT_MS = PROJECT_RENAME_TIMEOUT_MS + 15_000;
export const PROJECT_RENAME_DAEMON_TIMEOUT_MS = PROJECT_RENAME_TIMEOUT_MS + 30_000;

/** Why the name in the field cannot be the folder's new name. */
export type ProjectRenameNameProblem =
  | "empty"
  | "unchanged"
  | "dot-name"
  | "separator"
  | "reserved-character"
  | "reserved-name"
  | "trailing-dot-or-space"
  | "too-long"
  | "case-with-worktrees"
  | "taken";

/** What keeps the folder from moving now: something using it, or something about the folder or the machine. */
export type ProjectRenameBlockerKind =
  | "session-working"
  | "session-opening"
  | "background-work"
  | "background-unchecked"
  | "terminal-open"
  | "rename-running"
  | "rename-unfinished"
  | "rename-record-unreadable"
  | "workspaces-unknown"
  | "folder-missing"
  | "protected-folder";

/**
 * Whether a blocker goes away by itself - the work ends, the shell closes, the other rename or the
 * daemon's retry finishes - so the dialog keeps asking; or stays until the reader changes something
 * elsewhere, so asking again would only repeat it.
 */
export const PROJECT_RENAME_BLOCKER_CLEARS: Readonly<Record<ProjectRenameBlockerKind, boolean>> = {
  "session-working": true,
  "session-opening": true,
  "background-work": true,
  "background-unchecked": true,
  "terminal-open": true,
  "rename-running": true,
  "rename-unfinished": true,
  "rename-record-unreadable": false,
  "workspaces-unknown": true,
  "folder-missing": false,
  "protected-folder": false,
};

export interface ProjectRenameBlocker {
  readonly kind: ProjectRenameBlockerKind;
  readonly label: string;
}

export interface ProjectRenameNameCheck {
  readonly problem: ProjectRenameNameProblem;
  readonly message: string;
}

/** What the rename dialog shows before anything moves. */
export interface ProjectRenamePreview {
  /** The folder the project's folder stays in, as this machine writes it. */
  readonly parentPath: string;
  readonly folderName: string;
  readonly blockers: readonly ProjectRenameBlocker[];
  /** Absent when the asked name is free; also absent when no name was asked about. */
  readonly name?: ProjectRenameNameCheck;
}

export interface ProjectRenameRequest {
  readonly name: string;
}

/** The renamed project, and the folder move every path inside it followed. */
export interface ProjectRenameResult {
  readonly project: Project;
  readonly from: string;
  readonly to: string;
}

export function parseProjectRenameRequest(value: unknown): ProjectRenameRequest {
  if (!isRecord(value)) throw new Error("Project rename request must be an object");
  const name = value["name"];
  if (typeof name !== "string" || name.length > PROJECT_RENAME_NAME_MAX_LENGTH * 4) throw new Error("Project rename request needs a name");
  return { name };
}

const UNIVERSAL_PROBLEM_WORDS: Readonly<Record<Exclude<ProjectRenameNameProblem, "taken">, string>> = {
  empty: "Enter a name.",
  unchanged: "That is the folder's name now.",
  "dot-name": "A folder cannot be named . or ..",
  separator: "A folder name cannot contain / or \\.",
  "reserved-character": "A folder name cannot contain control characters, or on Windows < > : \" | ? *.",
  "reserved-name": "On Windows CON, PRN, AUX, NUL, COM1-9 and LPT1-9 are reserved names.",
  "trailing-dot-or-space": "On Windows a folder name cannot end with a dot or a space.",
  "too-long": "That name is too long for a folder.",
  "case-with-worktrees": "On this disk a rename that only changes the letter case would leave the workspaces inside the project's folder under the old spelling, and their sessions would no longer show. Rename it to another name first, then to this one.",
};

export function projectRenameNameWords(problem: ProjectRenameNameProblem, name: string): string {
  return problem === "taken" ? `There is already a folder named ${name} here.` : UNIVERSAL_PROBLEM_WORDS[problem];
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const WINDOWS_RESERVED_CHARACTER = /[<>:"|?*]/;
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * What is wrong with a folder name before any disk is asked, or undefined when the name could be a
 * folder's. `windows` adds that platform's rules; the daemon passes its own platform, the browser
 * checks only what holds everywhere and leaves the rest to the daemon's answer.
 */
export function folderNameProblem(raw: string, currentName: string, windows: boolean): Exclude<ProjectRenameNameProblem, "taken"> | undefined {
  const name = raw.trim();
  if (name === "") return "empty";
  if (name === currentName) return "unchanged";
  if (name === "." || name === "..") return "dot-name";
  if (name.includes("/") || name.includes("\\")) return "separator";
  if (CONTROL_CHARACTER.test(name) || (windows && WINDOWS_RESERVED_CHARACTER.test(name))) return "reserved-character";
  if (windows && WINDOWS_RESERVED_NAME.test(name)) return "reserved-name";
  if (windows && /[. ]$/.test(name)) return "trailing-dot-or-space";
  if (new TextEncoder().encode(name).length > PROJECT_RENAME_NAME_MAX_LENGTH) return "too-long";
  return undefined;
}
