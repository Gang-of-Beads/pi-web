export const GIT_STATUS_OPERATION = "status";
export const GIT_DIFF_OPERATION = "diff";
export const GIT_HISTORY_OPERATION = "history";
export const GIT_COMMIT_DIFF_OPERATION = "commit-diff";

export interface GitCommitSummary {
  id: string;
  parentIds: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
}

/** Opaque cursor returned by a preceding history response, if any. */
export interface GitHistoryRequest {
  cursor?: string;
}

export interface GitHistoryResponse {
  /** `true` when the worktree's HEAD does not yet name a commit. */
  unborn: boolean;
  commits: GitCommitSummary[];
  nextCursor?: string;
  truncated: boolean;
}

export interface GitCommitDiffRequest {
  /** Complete SHA-1 or SHA-256 commit object identifier from a history row. */
  id: string;
}

export interface GitCommitDiffResponse {
  commit: GitCommitSummary;
  /** A merge patch uses Git's combined (`--cc`) comparison against all parents. */
  combined: boolean;
  diff: string;
  truncated: boolean;
}

export type GitFileState = "unmodified" | "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "ignored" | "conflicted";

export interface GitStatusFile {
  path: string;
  oldPath?: string;
  index: GitFileState;
  workingTree: GitFileState;
  submoduleFromCommit?: string;
  submoduleToCommit?: string;
}

export interface GitStatusResponse {
  isGitRepo: boolean;
  hash: string;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  files: GitStatusFile[];
  submodules: string[];
}

export interface GitDiffResponse {
  path?: string;
  staged: boolean;
  hash: string;
  diff: string;
  truncated: boolean;
}

export function parseGitHistoryResponse(value: unknown): GitHistoryResponse {
  const record = requireRecord(value, "Git history response");
  const nextCursor = optionalString(record, "nextCursor");
  const unborn = requireBoolean(record, "unborn");
  const commits = requireArray(record, "commits").map(parseGitCommitSummary);
  if (unborn && (commits.length !== 0 || nextCursor !== undefined)) {
    throw new Error("Unborn Git history response must not contain commits or a cursor");
  }
  return {
    unborn,
    commits,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    truncated: requireBoolean(record, "truncated"),
  };
}

export function parseGitCommitDiffResponse(value: unknown): GitCommitDiffResponse {
  const record = requireRecord(value, "Git commit diff response");
  return {
    commit: parseGitCommitSummary(record["commit"]),
    combined: requireBoolean(record, "combined"),
    diff: requireString(record, "diff"),
    truncated: requireBoolean(record, "truncated"),
  };
}

export function parseGitStatusResponse(value: unknown): GitStatusResponse {
  const record = requireRecord(value, "Git status response");
  const branch = optionalString(record, "branch");
  const upstream = optionalString(record, "upstream");
  const ahead = optionalNumber(record, "ahead");
  const behind = optionalNumber(record, "behind");
  return {
    isGitRepo: requireBoolean(record, "isGitRepo"),
    hash: requireString(record, "hash"),
    ...(branch === undefined ? {} : { branch }),
    ...(upstream === undefined ? {} : { upstream }),
    ...(ahead === undefined ? {} : { ahead }),
    ...(behind === undefined ? {} : { behind }),
    files: requireArray(record, "files").map(parseGitStatusFile),
    submodules: record["submodules"] === undefined ? [] : requireStringArray(record["submodules"], "submodules"),
  };
}

export function parseGitDiffResponse(value: unknown): GitDiffResponse {
  const record = requireRecord(value, "Git diff response");
  const path = optionalString(record, "path");
  return {
    ...(path === undefined ? {} : { path }),
    staged: requireBoolean(record, "staged"),
    hash: requireString(record, "hash"),
    diff: requireString(record, "diff"),
    truncated: requireBoolean(record, "truncated"),
  };
}

function parseGitCommitSummary(value: unknown): GitCommitSummary {
  const record = requireRecord(value, "Git commit summary");
  const id = requireString(record, "id");
  if (!isCompleteObjectId(id)) throw new Error("Git commit summary id must be a complete object ID");
  return {
    id,
    parentIds: requireStringArray(record["parentIds"], "parentIds").map((parentId) => {
      if (!isCompleteObjectId(parentId)) throw new Error("Git commit parent ID must be a complete object ID");
      return parentId;
    }),
    authorName: requireString(record, "authorName"),
    authorEmail: requireString(record, "authorEmail"),
    authoredAt: requireString(record, "authoredAt"),
    subject: requireString(record, "subject"),
  };
}

function parseGitStatusFile(value: unknown): GitStatusFile {
  const record = requireRecord(value, "Git status file");
  const oldPath = optionalString(record, "oldPath");
  const submoduleFromCommit = optionalString(record, "submoduleFromCommit");
  const submoduleToCommit = optionalString(record, "submoduleToCommit");
  return {
    path: requireString(record, "path"),
    ...(oldPath === undefined ? {} : { oldPath }),
    index: parseGitFileState(record["index"]),
    workingTree: parseGitFileState(record["workingTree"]),
    ...(submoduleFromCommit === undefined ? {} : { submoduleFromCommit }),
    ...(submoduleToCommit === undefined ? {} : { submoduleToCommit }),
  };
}

function parseGitFileState(value: unknown): GitFileState {
  switch (value) {
    case "unmodified":
    case "modified":
    case "added":
    case "deleted":
    case "renamed":
    case "copied":
    case "untracked":
    case "ignored":
    case "conflicted":
      return value;
    default:
      throw new Error("Invalid Git file state");
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`Expected array field: ${key}`);
  return value;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`Expected string field: ${key}`);
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`Expected boolean field: ${key}`);
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Expected string field: ${key}`);
  return value;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected number field: ${key}`);
  return value;
}

function requireStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new Error(`Expected string array field: ${key}`);
  return value;
}

function isCompleteObjectId(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
