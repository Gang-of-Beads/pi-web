/**
 * Keeps a git hook's repository out of the tests.
 *
 * Git runs hooks with GIT_DIR (and, for some hooks, GIT_INDEX_FILE and GIT_WORK_TREE) in the
 * environment. Tests that start git in their own temporary folders then talk to the repository
 * being pushed instead: pushed from a worktree, the pre-push verify listed this repository's files
 * as a temporary project's file suggestions and failed two workspace-file tests that pass when the
 * suite runs on its own (2026-10-13). From the main checkout GIT_DIR is the relative ".git", which
 * finds nothing from a temporary folder, so the leak stayed hidden there. Vitest starts its workers
 * from this process's environment after global setup, so clearing them here reaches every test file.
 */
const REPOSITORY_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"] as const;

export default function noInheritedGitRepository(): void {
  for (const name of REPOSITORY_VARIABLES) Reflect.deleteProperty(process.env, name);
}
