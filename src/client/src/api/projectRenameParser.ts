import { PROJECT_RENAME_BLOCKER_CLEARS, type ProjectRenameBlockerKind, type ProjectRenameResult } from "../../../shared/projectRenameProtocol";
import { isRecord } from "../../../shared/unknownValues";
import { parseProject } from "./parsers";

/** Something in the way of the rename, in the machine's words, and whether it goes away by itself. */
export interface ProjectRenameViewBlocker {
  readonly label: string;
  readonly clears: boolean;
}

/**
 * What the rename dialog shows from the machine's preview: where the folder stays, its name now,
 * what is in the way, and what is wrong with the asked name. A newer machine's new kinds of
 * blocker still show, by their words, and are taken to go away by themselves, so the dialog keeps
 * asking rather than give up on one it does not know.
 */
export interface ProjectRenameView {
  readonly parentPath: string;
  readonly folderName: string;
  readonly blockers: readonly ProjectRenameViewBlocker[];
  /** The machine is renaming a project right now. */
  readonly renaming: boolean;
  /** Absent when the asked name is free, or none was asked about. */
  readonly nameProblem?: string;
}

export function parseProjectRenameView(value: unknown): ProjectRenameView {
  if (!isRecord(value)) throw new Error("Invalid project rename preview");
  const { parentPath, folderName, blockers, name } = value;
  if (typeof parentPath !== "string" || typeof folderName !== "string" || !Array.isArray(blockers)) throw new Error("Invalid project rename preview");
  const parsed = blockers.flatMap((blocker): ProjectRenameViewBlocker[] => {
    if (!isRecord(blocker) || typeof blocker["label"] !== "string") return [];
    const kind = blocker["kind"];
    return [{ label: blocker["label"], clears: !isBlockerKind(kind) || PROJECT_RENAME_BLOCKER_CLEARS[kind] }];
  });
  const message = isRecord(name) && typeof name["message"] === "string" ? name["message"] : undefined;
  const renaming = blockers.some((blocker) => isRecord(blocker) && blocker["kind"] === "rename-running");
  return { parentPath, folderName, blockers: parsed, renaming, ...(message === undefined ? {} : { nameProblem: message }) };
}

export function parseProjectRenameResult(value: unknown): ProjectRenameResult {
  if (!isRecord(value)) throw new Error("Invalid project rename answer");
  const { project, from, to } = value;
  if (typeof from !== "string" || typeof to !== "string") throw new Error("Invalid project rename answer");
  return { project: parseProject(project), from, to };
}

function isBlockerKind(value: unknown): value is ProjectRenameBlockerKind {
  return typeof value === "string" && Object.hasOwn(PROJECT_RENAME_BLOCKER_CLEARS, value);
}
