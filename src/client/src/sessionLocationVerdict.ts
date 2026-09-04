/**
 * Decide whether the selected workspace already describes a session's
 * directory.
 *
 * Workspaces list subdirectory sessions by design, so a project rooted at a
 * broad directory legitimately contains sessions that other projects also
 * claim. Selecting one of those sessions used to trigger the global locator,
 * which reassigned the Project chip to the deepest claimant while the session
 * list kept answering for the workspace the user chose - two surfaces
 * disagreeing about the current scope. The locator is for directories nobody
 * on screen claims, not for overriding an explicit choice that already covers
 * the session.
 */

import { normalizeSessionPath } from "./sessionPaths";

export type SessionLocationVerdict = "described" | "unknown";

export function sessionLocationVerdict(cwd: string, selectedWorkspacePath: string | undefined): SessionLocationVerdict {
  if (cwd === "" || selectedWorkspacePath === undefined || selectedWorkspacePath === "") return "unknown";
  const child = normalizeSessionPath(cwd);
  const parent = normalizeSessionPath(selectedWorkspacePath);
  if (parent === "" || child === "") return "unknown";
  if (child === parent) return "described";
  const separator = parent.includes("\\") || child.includes("\\") ? "\\" : "/";
  return child.startsWith(`${parent}${separator}`) ? "described" : "unknown";
}
