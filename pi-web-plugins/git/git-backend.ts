import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type {
  JsonValue,
  ProviderRequestContext,
  ProviderResponse,
  ServerPluginActivationContext,
  ServerPluginExecFileResult,
} from "@gang-of-beads/pi-web/server-plugin-api";
import {
  GIT_COMMIT_DIFF_OPERATION,
  GIT_DIFF_OPERATION,
  GIT_HISTORY_OPERATION,
  GIT_STATUS_OPERATION,
  type GitCommitDiffRequest,
  type GitCommitDiffResponse,
  type GitCommitSummary,
  type GitDiffResponse,
  type GitHistoryRequest,
  type GitHistoryResponse,
  type GitFileState,
  type GitStatusFile,
  type GitStatusResponse,
} from "./browser/git-contract.js";

export {
  GIT_COMMIT_DIFF_OPERATION,
  GIT_DIFF_OPERATION,
  GIT_HISTORY_OPERATION,
  GIT_STATUS_OPERATION,
} from "./browser/git-contract.js";
export type {
  GitCommitDiffRequest,
  GitCommitDiffResponse,
  GitCommitSummary,
  GitDiffResponse,
  GitFileState,
  GitHistoryRequest,
  GitHistoryResponse,
  GitStatusFile,
  GitStatusResponse,
} from "./browser/git-contract.js";

const GIT_COMMAND_TIMEOUT_MS = 10_000;
const HISTORY_PAGE_SIZE = 50;
const MAX_HISTORY_OFFSET = 10_000;
const COMMIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const HISTORY_LOG_FORMAT = "%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00";
const GIT_LOCAL_ENV_VARS = Object.freeze([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_QUARANTINE_PATH",
  "GIT_WORK_TREE",
]);

type RunGit = (cwd: string, args: readonly string[]) => Promise<GitCommandResult>;

interface GitCommandResult {
  code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

interface ValidatedSubmodule {
  path: string;
  cwd: string;
}

/** Dispatch the Git-owned status/diff schema through the provider's public request seam. */
export async function requestGitBackend(
  activationContext: ServerPluginActivationContext,
  request: ProviderRequestContext,
): Promise<ProviderResponse> {
  const runGit = createGitRunner(activationContext, request.signal);
  if (request.operation === GIT_STATUS_OPERATION) {
    requireStatusInput(request.input);
    return statusProviderResponse(await gitStatusWithRunner(runGit, request.workspace.path));
  }
  if (request.operation === GIT_DIFF_OPERATION) {
    return diffProviderResponse(await gitDiffWithRunner(runGit, request.workspace.path, parseDiffInput(request.input)));
  }
  if (request.operation === GIT_HISTORY_OPERATION) {
    return historyProviderResponse(await gitHistoryWithRunner(runGit, request.workspace.path, parseHistoryInput(request.input)));
  }
  if (request.operation === GIT_COMMIT_DIFF_OPERATION) {
    return commitDiffProviderResponse(await gitCommitDiffWithRunner(runGit, request.workspace.path, parseCommitDiffInput(request.input)));
  }
  throw new Error(`Unsupported Git workspace backend operation: ${request.operation}`);
}

/**
 * A submodule row parsed from the superproject status. `git status` reports a
 * submodule as a single path with an `S<c><m><u>` flag field (commit changed /
 * modified tracked content / untracked content) but never lists the files that
 * changed inside it, so we recurse in `expandSubmodules`.
 */
interface SubmoduleRecord {
  path: string;
  index: GitFileState;
  workingTree: GitFileState;
  commitChanged: boolean;
  hasModifiedContent: boolean;
  hasUntrackedContent: boolean;
  headOid: string;
  indexOid: string;
}

interface ParsedStatus {
  isGitRepo: true;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  files: GitStatusFile[];
  submodules: SubmoduleRecord[];
}

export async function gitStatus(
  context: ServerPluginActivationContext,
  cwd: string,
  signal: AbortSignal,
): Promise<GitStatusResponse> {
  return gitStatusWithRunner(createGitRunner(context, signal), cwd);
}

async function gitStatusWithRunner(runGit: RunGit, cwd: string): Promise<GitStatusResponse> {
  const result = await runGit(cwd, ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"]);
  if (result.code !== 0) return { isGitRepo: false, hash: hash(result.stdout + result.stderr), files: [], submodules: [] };
  const parsed = parseStatus(result.stdout, { deferSubmodules: true });
  return expandSubmodules(runGit, cwd, parsed, result.stdout);
}

/**
 * Merge each dirty submodule's own changes into the flat file list. A moved
 * commit pointer becomes a single entry keyed by the submodule path (carrying
 * the short SHAs for display); modified/untracked content is listed as regular
 * entries under `<submodule>/<inner path>`. A plain `-dirty` pointer (commit
 * unchanged) is intentionally not surfaced as a pointer entry.
 */
async function expandSubmodules(runGit: RunGit, cwd: string, parsed: ParsedStatus, topRaw: string): Promise<GitStatusResponse> {
  // Fan out concurrently — one `git status` per dirty submodule plus one
  // `git rev-parse` per unstaged pointer move — then concatenate in input
  // order so the file list and hash are identical to a serial pass.
  const canonicalRoot = parsed.submodules.length === 0 ? undefined : await canonicalPath(cwd);
  const expanded = await Promise.all(parsed.submodules.map(async (sub) => {
    const location = canonicalRoot === undefined
      ? undefined
      : await validatedSubmodule(runGit, cwd, canonicalRoot, sub.path);
    return { path: sub.path, ...(await expandSubmodule(runGit, sub, location)) };
  }));

  const files: GitStatusFile[] = [...parsed.files];
  const dirtySubmodulePaths: string[] = [];
  let extraForHash = "";
  for (const part of expanded) {
    dirtySubmodulePaths.push(part.path);
    files.push(...part.files);
    extraForHash += part.extraForHash;
  }

  return {
    isGitRepo: true,
    hash: hash(topRaw + extraForHash),
    ...(parsed.branch === undefined ? {} : { branch: parsed.branch }),
    ...(parsed.upstream === undefined ? {} : { upstream: parsed.upstream }),
    ...(parsed.ahead === undefined ? {} : { ahead: parsed.ahead }),
    ...(parsed.behind === undefined ? {} : { behind: parsed.behind }),
    files,
    submodules: dirtySubmodulePaths,
  };
}

/** Expand one dirty submodule: the pointer entry first, then its inner files. */
async function expandSubmodule(
  runGit: RunGit,
  sub: SubmoduleRecord,
  location: ValidatedSubmodule | undefined,
): Promise<{ files: GitStatusFile[]; extraForHash: string }> {
  const files: GitStatusFile[] = [];
  let extraForHash = "";
  if (sub.commitChanged) {
    files.push({
      path: sub.path,
      index: sub.index,
      workingTree: sub.workingTree,
      submoduleFromCommit: displayFromCommit(sub.headOid),
      submoduleToCommit: short(await resolveSubmoduleToCommit(runGit, location?.cwd, sub)),
    });
  }
  if ((sub.hasModifiedContent || sub.hasUntrackedContent) && location !== undefined) {
    const inner = await runGit(location.cwd, ["status", "--porcelain=v2", "--untracked-files=all", "-z"]);
    if (inner.code === 0) {
      extraForHash = `\0${sub.path}\0${inner.stdout}`;
      const innerFiles = parseStatus(inner.stdout, { deferSubmodules: false }).files;
      for (const file of innerFiles) {
        files.push({
          ...file,
          path: `${sub.path}/${file.path}`,
          ...(file.oldPath === undefined ? {} : { oldPath: `${sub.path}/${file.oldPath}` }),
        });
      }
    }
    // non-zero exit: uninitialized / unreadable submodule — skip silently
  }
  return { files, extraForHash };
}

async function resolveSubmoduleToCommit(runGit: RunGit, cwd: string | undefined, sub: SubmoduleRecord): Promise<string> {
  // Staged pointer moves already expose the new commit as the index OID; an
  // unstaged move only records the old OID, so read the validated submodule's
  // HEAD. An unavailable checkout cannot safely supply a different pointer.
  if (sub.indexOid !== sub.headOid || cwd === undefined) return sub.indexOid;
  const head = await runGit(cwd, ["rev-parse", "HEAD"]);
  const resolved = head.stdout.trim();
  return head.code === 0 && resolved !== "" ? resolved : sub.indexOid;
}

export async function gitDiff(
  context: ServerPluginActivationContext,
  cwd: string,
  options: { path?: string; staged?: boolean },
  signal: AbortSignal,
): Promise<GitDiffResponse> {
  return gitDiffWithRunner(createGitRunner(context, signal), cwd, options);
}

export async function gitHistory(
  context: ServerPluginActivationContext,
  cwd: string,
  options: GitHistoryRequest,
  signal: AbortSignal,
): Promise<GitHistoryResponse> {
  return gitHistoryWithRunner(createGitRunner(context, signal), cwd, options);
}

async function gitHistoryWithRunner(runGit: RunGit, cwd: string, options: GitHistoryRequest): Promise<GitHistoryResponse> {
  const snapshot = options.cursor === undefined
    ? await resolveHistoryHead(runGit, cwd)
    : decodeHistoryCursor(options.cursor);
  if (snapshot === undefined) return { unborn: true, commits: [], truncated: false };

  await requireCommitObject(runGit, cwd, snapshot.head, "History snapshot commit is unavailable");
  const result = await runGit(cwd, [
    "log", "--no-color", "-z", `--format=${HISTORY_LOG_FORMAT}`,
    `--max-count=${String(HISTORY_PAGE_SIZE + 1)}`, `--skip=${String(snapshot.offset)}`, snapshot.head,
  ]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "git log failed");
  if (result.truncated) throw new Error("Git history output exceeded the host output limit");
  const commits = parseHistoryLog(result.stdout);
  const hasNextPage = commits.length > HISTORY_PAGE_SIZE;
  const page = commits.slice(0, HISTORY_PAGE_SIZE);
  return {
    unborn: false,
    commits: page,
    ...(hasNextPage ? { nextCursor: encodeHistoryCursor({ head: snapshot.head, offset: snapshot.offset + page.length }) } : {}),
    truncated: false,
  };
}

export async function gitCommitDiff(
  context: ServerPluginActivationContext,
  cwd: string,
  input: GitCommitDiffRequest,
  signal: AbortSignal,
): Promise<GitCommitDiffResponse> {
  return gitCommitDiffWithRunner(createGitRunner(context, signal), cwd, input);
}

async function gitCommitDiffWithRunner(runGit: RunGit, cwd: string, input: GitCommitDiffRequest): Promise<GitCommitDiffResponse> {
  if (!COMMIT_OBJECT_ID.test(input.id)) throw new Error("Git commit diff input id must be a complete object ID");
  await requireCommitObject(runGit, cwd, input.id, "Git commit is unavailable");
  const reachable = await runGit(cwd, ["merge-base", "--is-ancestor", input.id, "HEAD"]);
  if (reachable.code === 1) throw new Error("Git commit is not reachable from the current HEAD");
  if (reachable.code !== 0) throw new Error(reachable.stderr.trim() || "Unable to validate Git commit reachability");

  const metadataResult = await runGit(cwd, ["log", "-1", "--no-color", "-z", `--format=${HISTORY_LOG_FORMAT}`, input.id]);
  if (metadataResult.code !== 0) throw new Error(metadataResult.stderr.trim() || "Unable to read Git commit metadata");
  if (metadataResult.truncated) throw new Error("Git commit metadata exceeded the host output limit");
  const [commit] = parseHistoryLog(metadataResult.stdout);
  if (commit?.id !== input.id) throw new Error("Git returned malformed commit metadata");
  const combined = commit.parentIds.length > 1;
  const result = await runGit(cwd, ["show", "--no-ext-diff", "--color=never", "--format=", ...(combined ? ["--cc"] : []), input.id]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "git show failed");
  return { commit, combined, diff: result.stdout, truncated: result.truncated };
}

async function resolveHistoryHead(runGit: RunGit, cwd: string): Promise<{ head: string; offset: number } | undefined> {
  const result = await runGit(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  if (result.code === 1) return undefined;
  if (result.code !== 0) throw new Error(result.stderr.trim() || "Unable to resolve current HEAD");
  const head = result.stdout.trim();
  if (!COMMIT_OBJECT_ID.test(head)) throw new Error("Git returned an invalid HEAD commit ID");
  return { head, offset: 0 };
}

async function requireCommitObject(runGit: RunGit, cwd: string, id: string, message: string): Promise<void> {
  const result = await runGit(cwd, ["cat-file", "-e", `${id}^{commit}`]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || message);
}

export function parseHistoryLog(raw: string): GitCommitSummary[] {
  if (raw === "") return [];
  const fields = raw.split("\0");
  if (fields.pop() !== "" || fields.length % 7 !== 0) throw new Error("Git returned malformed NUL-delimited history output");
  const commits: GitCommitSummary[] = [];
  for (let index = 0; index < fields.length; index += 7) {
    const [id, parents, authorName, authorEmail, authoredAt, subject, separator] = fields.slice(index, index + 7);
    if (separator !== "") throw new Error("Git returned malformed NUL-delimited history output");
    if (id === undefined || parents === undefined || authorName === undefined || authorEmail === undefined || authoredAt === undefined || subject === undefined
      || !COMMIT_OBJECT_ID.test(id)
      || (parents !== "" && !parents.split(" ").every((parent) => COMMIT_OBJECT_ID.test(parent)))) {
      throw new Error("Git returned malformed NUL-delimited history output");
    }
    commits.push({ id, parentIds: parents === "" ? [] : parents.split(" "), authorName, authorEmail, authoredAt, subject });
  }
  return commits;
}

function encodeHistoryCursor(snapshot: { head: string; offset: number }): string {
  return Buffer.from(JSON.stringify(snapshot)).toString("base64url");
}

function decodeHistoryCursor(cursor: string): { head: string; offset: number } {
  if (cursor.length === 0 || cursor.length > 256) throw new Error("Git history cursor is invalid");
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!isRecord(value)) throw new Error();
    const record = value;
    const head = record["head"];
    const offset = record["offset"];
    if (Object.keys(record).length !== 2 || typeof head !== "string" || !COMMIT_OBJECT_ID.test(head)
      || typeof offset !== "number" || !Number.isSafeInteger(offset)
      || offset < 1 || offset > MAX_HISTORY_OFFSET) throw new Error();
    return { head, offset };
  } catch {
    throw new Error("Git history cursor is invalid");
  }
}

async function gitDiffWithRunner(runGit: RunGit, cwd: string, options: { path?: string; staged?: boolean }): Promise<GitDiffResponse> {
  const staged = options.staged === true;
  let path: string | undefined;
  if (options.path !== undefined && options.path !== "") path = normalizeRelativePath(options.path);

  if (path !== undefined) {
    const owner = await submoduleForPath(runGit, cwd, path);
    if (owner !== undefined) return submoduleDiff(runGit, owner, path, staged);
  }

  const args = ["diff", "--no-ext-diff", "--color=never"];
  if (staged) args.push("--cached");
  if (path !== undefined) args.push("--", path);

  const result = await runGit(cwd, args);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "git diff failed");
  if (!staged && path !== undefined && result.stdout === "" && await isUntracked(runGit, cwd, path)) {
    const untracked = await runGit(cwd, ["diff", "--no-ext-diff", "--color=never", "--no-index", "/dev/null", "--", path]);
    if (untracked.code !== 0 && untracked.code !== 1) throw new Error(untracked.stderr.trim() || "git diff failed");
    return { path, staged, hash: hash(untracked.stdout), diff: untracked.stdout, truncated: untracked.truncated };
  }
  return { ...(path === undefined ? {} : { path }), staged, hash: hash(result.stdout), diff: result.stdout, truncated: result.truncated };
}

/**
 * Run the diff inside the owning submodule's working tree, since `git diff` at
 * the superproject root never shows content changes below a submodule boundary.
 * The response path stays the full superproject-relative path so the viewer and
 * the selected row line up.
 */
async function submoduleDiff(runGit: RunGit, owner: ValidatedSubmodule, path: string, staged: boolean): Promise<GitDiffResponse> {
  const subCwd = owner.cwd;
  const rel = normalizeRelativePath(path.slice(owner.path.length + 1));

  const args = ["diff", "--no-ext-diff", "--color=never"];
  if (staged) args.push("--cached");
  args.push("--", rel);

  const result = await runGit(subCwd, args);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "git diff failed");
  if (!staged && result.stdout === "" && await isUntracked(runGit, subCwd, rel)) {
    const untracked = await runGit(subCwd, ["diff", "--no-ext-diff", "--color=never", "--no-index", "/dev/null", "--", rel]);
    if (untracked.code !== 0 && untracked.code !== 1) throw new Error(untracked.stderr.trim() || "git diff failed");
    return { path, staged, hash: hash(untracked.stdout), diff: untracked.stdout, truncated: untracked.truncated };
  }
  return { path, staged, hash: hash(result.stdout), diff: result.stdout, truncated: result.truncated };
}

async function isUntracked(runGit: RunGit, cwd: string, path: string): Promise<boolean> {
  const result = await runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z", "--", path]);
  return result.code === 0 && result.stdout.split("\0").includes(path);
}

/** Configured direct-submodule paths (depth 1), read from `.gitmodules`. */
async function configuredSubmodulePaths(runGit: RunGit, cwd: string): Promise<string[]> {
  // `-z` emits `<key>\n<value>\0` records; keys may themselves contain spaces
  // (`submodule.my sub.path`), so splitting lines at the first space mangles
  // paths with spaces in them.
  const result = await runGit(cwd, ["config", "-z", "--file", ".gitmodules", "--get-regexp", "^submodule\\..+\\.path$"]);
  if (result.code !== 0) return [];
  const paths: string[] = [];
  for (const record of result.stdout.split("\0")) {
    if (record === "") continue;
    const newlineAt = record.indexOf("\n");
    if (newlineAt === -1) continue;
    try {
      const path = normalizeRelativePath(record.slice(newlineAt + 1));
      if (path !== "") paths.push(path);
    } catch {
      // A malformed repository path is not eligible for submodule routing.
    }
  }
  return [...new Set(paths)];
}

/** The validated gitlink that strictly contains `path`, if any (longest match wins). */
async function submoduleForPath(runGit: RunGit, cwd: string, path: string): Promise<ValidatedSubmodule | undefined> {
  if (!path.includes("/")) return undefined;
  const candidates = (await configuredSubmodulePaths(runGit, cwd))
    .filter((sub) => path.startsWith(`${sub}/`))
    .sort((left, right) => right.length - left.length);
  if (candidates.length === 0) return undefined;

  const canonicalRoot = await canonicalPath(cwd);
  if (canonicalRoot === undefined) return undefined;
  for (const candidate of candidates) {
    const validated = await validatedSubmodule(runGit, cwd, canonicalRoot, candidate);
    if (validated !== undefined) return validated;
  }
  return undefined;
}

/**
 * Confirm that repository-controlled `.gitmodules` data names an index
 * gitlink and that its checkout resolves strictly below the workspace root.
 * Commands use the resolved checkout rather than following the configured
 * path as a symlink.
 */
async function validatedSubmodule(
  runGit: RunGit,
  cwd: string,
  canonicalRoot: string,
  path: string,
): Promise<ValidatedSubmodule | undefined> {
  const index = await runGit(cwd, ["ls-files", "--stage", "-z", "--", path]);
  if (index.code !== 0 || !hasGitlink(index.stdout, path)) return undefined;

  const candidate = await canonicalPath(join(cwd, path));
  if (candidate === undefined || !isStrictDescendant(canonicalRoot, candidate)) return undefined;
  return { path, cwd: candidate };
}

function hasGitlink(raw: string, path: string): boolean {
  return raw.split("\0").some((record) => {
    const separator = record.indexOf("\t");
    if (separator === -1 || record.slice(separator + 1) !== path) return false;
    return record.slice(0, separator).split(" ")[0] === "160000";
  });
}

async function canonicalPath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

function isStrictDescendant(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation !== ""
    && relation !== ".."
    && !relation.startsWith(`..${sep}`)
    && !isAbsolute(relation);
}

function parseStatus(raw: string, options: { deferSubmodules: boolean }): ParsedStatus {
  const records = raw.split("\0").filter((record) => record !== "");
  const files: GitStatusFile[] = [];
  const submodules: SubmoduleRecord[] = [];
  let branch: string | undefined;
  let upstream: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record === undefined) continue;
    if (record.startsWith("# branch.head ")) branch = normalizeBranch(record.slice("# branch.head ".length));
    else if (record.startsWith("# branch.upstream ")) upstream = record.slice("# branch.upstream ".length);
    else if (record.startsWith("# branch.ab ")) {
      const match = /\+(\d+) -(\d+)/.exec(record);
      if (match) { ahead = Number(match[1]); behind = Number(match[2]); }
    } else if (record.startsWith("? ")) files.push({ path: record.slice(2), index: "untracked", workingTree: "untracked" });
    else if (record.startsWith("! ")) files.push({ path: record.slice(2), index: "ignored", workingTree: "ignored" });
    else if (record.startsWith("1 ")) {
      const parts = record.split(" ");
      const sub = parts[2];
      const path = parts.slice(8).join(" ");
      const index = stateFor(parts[1]?.[0]);
      const workingTree = stateFor(parts[1]?.[1]);
      // A deleted gitlink has no pointer move or inner content to expand (a
      // staged deletion even reports the index OID as all zeros), so keep it
      // as a plain row instead of deferring it as a submodule.
      if (options.deferSubmodules && sub?.startsWith("S") === true && index !== "deleted" && workingTree !== "deleted") {
        const headOid = parts[6] ?? "";
        const indexOid = parts[7] ?? "";
        submodules.push({
          path,
          index,
          workingTree,
          // `c` only flags unstaged moves (submodule HEAD left the index OID);
          // a staged move leaves HEAD == index, so compare the recorded OIDs.
          commitChanged: sub[1] === "C" || headOid !== indexOid,
          hasModifiedContent: sub[2] === "M",
          hasUntrackedContent: sub[3] === "U",
          headOid,
          indexOid,
        });
      } else {
        files.push({ path, index, workingTree });
      }
    } else if (record.startsWith("2 ")) {
      const parts = record.split(" ");
      const path = parts.slice(9).join(" ");
      const oldPath = records[i + 1];
      i += 1;
      files.push({ path, ...(oldPath === undefined ? {} : { oldPath }), index: stateFor(parts[1]?.[0]), workingTree: stateFor(parts[1]?.[1]) });
    } else if (record.startsWith("u ")) {
      const parts = record.split(" ");
      files.push({ path: parts.slice(10).join(" "), index: "conflicted", workingTree: "conflicted" });
    }
  }

  return { isGitRepo: true, ...(branch === undefined ? {} : { branch }), ...(upstream === undefined ? {} : { upstream }), ...(ahead === undefined ? {} : { ahead }), ...(behind === undefined ? {} : { behind }), files, submodules };
}

function stateFor(code: string | undefined): GitFileState {
  if (code === undefined) return "unmodified";
  switch (code) {
    case ".": return "unmodified";
    case "M": return "modified";
    case "A": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    case "U": return "conflicted";
    default: return "unmodified";
  }
}

function normalizeBranch(value: string): string | undefined {
  return value === "(detached)" ? undefined : value;
}

function short(oid: string): string {
  return oid.slice(0, 7);
}

/** A newly staged submodule records an all-zero head OID; display the pointer as `new → <sha>`. */
function displayFromCommit(headOid: string): string {
  return /^0+$/.test(headOid) ? "new" : short(headOid);
}

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function statusProviderResponse(status: GitStatusResponse): ProviderResponse {
  return {
    isGitRepo: status.isGitRepo,
    hash: status.hash,
    ...(status.branch === undefined ? {} : { branch: status.branch }),
    ...(status.upstream === undefined ? {} : { upstream: status.upstream }),
    ...(status.ahead === undefined ? {} : { ahead: status.ahead }),
    ...(status.behind === undefined ? {} : { behind: status.behind }),
    files: status.files.map((file) => ({
      path: file.path,
      ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
      index: file.index,
      workingTree: file.workingTree,
      ...(file.submoduleFromCommit === undefined ? {} : { submoduleFromCommit: file.submoduleFromCommit }),
      ...(file.submoduleToCommit === undefined ? {} : { submoduleToCommit: file.submoduleToCommit }),
    })),
    submodules: status.submodules,
  };
}

function historyProviderResponse(history: GitHistoryResponse): ProviderResponse {
  return {
    unborn: history.unborn,
    commits: history.commits.map(commitProviderResponse),
    ...(history.nextCursor === undefined ? {} : { nextCursor: history.nextCursor }),
    truncated: history.truncated,
  };
}

function commitDiffProviderResponse(diff: GitCommitDiffResponse): ProviderResponse {
  return { commit: commitProviderResponse(diff.commit), combined: diff.combined, diff: diff.diff, truncated: diff.truncated };
}

function commitProviderResponse(commit: GitCommitSummary): ProviderResponse {
  return {
    id: commit.id,
    parentIds: commit.parentIds,
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    authoredAt: commit.authoredAt,
    subject: commit.subject,
  };
}

function diffProviderResponse(diff: GitDiffResponse): ProviderResponse {
  return {
    ...(diff.path === undefined ? {} : { path: diff.path }),
    staged: diff.staged,
    hash: diff.hash,
    diff: diff.diff,
    truncated: diff.truncated,
  };
}

function createGitRunner(context: ServerPluginActivationContext, signal: AbortSignal): RunGit {
  return async (cwd, args) => commandResult(await context.execFile({
    file: "git",
    args,
    cwd,
    unsetEnv: GIT_LOCAL_ENV_VARS,
    timeoutMs: GIT_COMMAND_TIMEOUT_MS,
    signal,
  }), args);
}

function commandResult(result: ServerPluginExecFileResult, args: readonly string[]): GitCommandResult {
  const command = `git ${args.join(" ")}`;
  if (result.signal !== null) throw new Error(`${command} ended from signal ${result.signal}`);
  if (result.exitCode === null) throw new Error(`${command} ended without an exit code`);
  return {
    code: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    truncated: result.stdoutTruncated,
  };
}

function requireStatusInput(input: JsonValue): void {
  if (input !== null) throw new Error("Git status input must be null");
}

function parseHistoryInput(input: JsonValue): GitHistoryRequest {
  if (input === null) return {};
  if (!isRecord(input)) throw new Error("Git history input must be null or an object");
  const unsupported = Object.keys(input).find((key) => key !== "cursor");
  if (unsupported !== undefined) throw new Error(`Git history input contains an unsupported field: ${unsupported}`);
  const cursor = input["cursor"];
  if (typeof cursor !== "string") throw new Error("Git history input cursor must be a string");
  decodeHistoryCursor(cursor);
  return { cursor };
}

function parseCommitDiffInput(input: JsonValue): GitCommitDiffRequest {
  if (!isRecord(input)) throw new Error("Git commit diff input must be an object");
  const unsupported = Object.keys(input).find((key) => key !== "id");
  if (unsupported !== undefined) throw new Error(`Git commit diff input contains an unsupported field: ${unsupported}`);
  const id = input["id"];
  if (typeof id !== "string" || !COMMIT_OBJECT_ID.test(id)) {
    throw new Error("Git commit diff input id must be a complete object ID");
  }
  return { id };
}

function parseDiffInput(input: JsonValue): { path?: string; staged?: boolean } {
  if (!isRecord(input)) throw new Error("Git diff input must be an object");
  const unsupported = Object.keys(input).find((key) => key !== "path" && key !== "staged");
  if (unsupported !== undefined) throw new Error(`Git diff input contains an unsupported field: ${unsupported}`);
  const path = input["path"];
  const staged = input["staged"];
  if (path !== undefined && typeof path !== "string") throw new Error("Git diff input path must be a string");
  if (staged !== undefined && typeof staged !== "boolean") throw new Error("Git diff input staged must be a boolean");
  return {
    ...(path === undefined ? {} : { path }),
    ...(staged === undefined ? {} : { staged }),
  };
}

function normalizeRelativePath(input: string | undefined): string {
  const value = input ?? "";
  if (value === "" || value === ".") return "";
  if (isAbsolute(value)) throw new Error("Absolute paths are not allowed");
  const parts = value.split(/[\\/]+/u).filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) throw new Error("Path traversal is not allowed");
  return parts.join("/");
}

function isRecord(value: unknown): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
