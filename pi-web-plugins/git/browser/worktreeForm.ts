/**
 * Where a new worktree goes by default: beside the repository, named after
 * it and the branch, with the branch's slashes flattened so `feat/x` does
 * not nest a directory. The reader can overwrite it; this is only the
 * suggestion the dialog opens with. Pure so the rule is testable without a
 * DOM, and so the browser never has to know the machine's path separator
 * beyond what the workspace path already shows.
 */
export function defaultWorktreePath(repositoryPath: string, branch: string): string {
  const separator = repositoryPath.includes("\\") && !repositoryPath.includes("/") ? "\\" : "/";
  const trimmed = repositoryPath.replace(/[\\/]+$/u, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const parent = cut <= 0 ? trimmed.slice(0, Math.max(cut, 0)) || separator : trimmed.slice(0, cut);
  const repository = trimmed.slice(cut + 1);
  const slug = branch.trim().replace(/[\\/]+/gu, "-").replace(/[^\w.-]+/gu, "-").replace(/^-+|-+$/gu, "");
  const name = slug === "" ? repository : `${repository}-${slug}`;
  return parent.endsWith(separator) ? `${parent}${name}` : `${parent}${separator}${name}`;
}

/** The dialog's own validation, before git gets to say anything. */
export type WorktreeFormVerdict =
  | { kind: "ready" }
  | { kind: "missing-branch" }
  | { kind: "missing-path" }
  | { kind: "relative-path" };

export function worktreeFormVerdict(input: { branch: string; path: string }): WorktreeFormVerdict {
  if (input.branch.trim() === "") return { kind: "missing-branch" };
  const path = input.path.trim();
  if (path === "") return { kind: "missing-path" };
  if (!(path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path))) return { kind: "relative-path" };
  return { kind: "ready" };
}
