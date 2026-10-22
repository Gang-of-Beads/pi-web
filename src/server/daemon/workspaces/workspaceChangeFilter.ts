import { isOwnershipMarkerFileName } from "../sessiondStateOwnership.js";

/**
 * Which file changes in a workspace are news (object model §1.16).
 *
 * The watcher used to publish on any change anywhere under a workspace, so
 * git's own writes (objects, lock files), `node_modules` and the task logs a
 * background run appends every second each became a git status plus a tree
 * read: 74 % of 8504's requests on 2026-09-30, with the daemon at 99 % CPU.
 * The owner asked for the mature tools' answer first; this follows VS Code's
 * git extension and GitLens (research run 8f558e71):
 * - inside `.git`, only the files that move git state are news - HEAD, the
 *   index, refs, packed-refs, the in-progress operation markers and config -
 *   so a commit made in a terminal still shows at once;
 * - lock files, objects and logs are git's own churn and never news;
 * - a submodule's git directory (`.git/modules/<name>/`) follows the same rules;
 * - the working tree is news, except dependency folders, pi's own sessions
 *   (`.pi/sessions`), the directories the running plugins declare their
 *   extensions write background work into (`workPaths` under `cwd`; core
 *   names none), each at any depth, and
 *   the git directories of nested clones, and the session daemon's ownership
 *   marker, whose heartbeat rewrites it every 10 s inside a data directory a
 *   session folder such as `~` may contain. Build output is news on purpose:
 *   the tree and git panels show it, and a busy build publishes at most once
 *   per 2.5 s window.
 *
 * `watchableDirectory` answers the same question for a whole directory, from
 * the same rules: where the platform has no native recursive watch, the
 * watcher opens one watch per directory (issue #59), and a directory is worth
 * one only when some path under it could be news. That leaves out dependency
 * folders, nested clones' git directories, pi's sessions, declared work
 * paths, and every directory of `.git` except the ones that can hold git
 * state (`.git` itself, `refs`, `info`, the in-progress operation
 * directories, and each submodule's git directory under `modules`).
 */
export type WorkspaceChange = "git-state" | "tree" | "noise";

const GIT_STATE_FILES = new Set(["HEAD", "index", "packed-refs", "config", "shallow"]);
const GIT_STATE_TREES = ["refs", "rebase-apply", "rebase-merge", "sequencer"];
const GIT_STATE_DIRECTORIES = new Set(["info", "modules"]);
const NOISE_SEGMENTS = new Set(["node_modules", "fsmonitor--daemon"]);
const PI_SESSIONS = [".pi", "sessions"];

export function classifyWorkspaceChange(relativePath: string | undefined, workPaths: readonly string[] = []): WorkspaceChange {
  if (relativePath === undefined || relativePath === "") return "tree";
  const segments = relativePath.replaceAll("\\", "/").split("/");
  if (segments.some(isNoiseSegment)) return "noise";
  if (isOwnershipMarkerFileName(segments.at(-1) ?? "")) return "noise";
  if (segments[0] === ".git") return gitChange(segments.slice(1));
  if (segments.includes(".git")) return "noise";
  return insideQuietRun(segments, workPaths) ? "noise" : "tree";
}

export function watchableDirectory(relativeDir: string, workPaths: readonly string[] = []): boolean {
  const segments = pathSegments(relativeDir);
  if (segments.some(isNoiseSegment)) return false;
  if (segments[0] === ".git") return watchableGitDirectory(segments.slice(1));
  if (segments.includes(".git")) return false;
  return !insideQuietRun(segments, workPaths);
}

function isNoiseSegment(segment: string): boolean {
  return NOISE_SEGMENTS.has(segment) || segment.startsWith(".watchman-cookie-");
}

function insideQuietRun(segments: readonly string[], workPaths: readonly string[]): boolean {
  const runs = [PI_SESSIONS, ...workPaths.map(pathSegments)].filter((run) => run.length > 0);
  return runs.some((run) => containsRun(segments, run));
}

function pathSegments(path: string): string[] {
  return path.replaceAll("\\", "/").split("/").filter((segment) => segment !== "" && segment !== ".");
}

function containsRun(segments: readonly string[], run: readonly string[]): boolean {
  return segments.some((_, index) => run.every((part, offset) => segments[index + offset] === part));
}

function gitChange(inside: readonly string[]): WorkspaceChange {
  const name = inside.at(-1) ?? "";
  if (name.endsWith(".lock")) return "noise";
  if (inside.length === 1) return isGitStateFile(name) ? "git-state" : "noise";
  if (inside.join("/") === "info/exclude") return "git-state";
  if (inside[0] === "modules" && inside.length > 2) return gitChange(inside.slice(2));
  return GIT_STATE_TREES.includes(inside[0] ?? "") ? "git-state" : "noise";
}

function watchableGitDirectory(inside: readonly string[]): boolean {
  if (inside.length === 0) return true;
  if (GIT_STATE_TREES.includes(inside[0] ?? "")) return true;
  if (inside.length === 1) return GIT_STATE_DIRECTORIES.has(inside[0] ?? "");
  if (inside[0] === "modules" && inside.length > 2) return watchableGitDirectory(inside.slice(2));
  return inside[0] === "modules";
}

function isGitStateFile(name: string): boolean {
  return GIT_STATE_FILES.has(name) || name.endsWith("_HEAD") || name.startsWith("MERGE_");
}
