import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { readdir, stat } from "node:fs/promises";
import type { ClientFileSuggestion } from "../types.js";

/**
 * Project folder suggestions.
 *
 * The picker is the only place a project path is typed, usually on a phone
 * keyboard, so a strict same-directory prefix match is a poor fit: it forces
 * the exact spelling of every intermediate segment. Instead this behaves like
 * a zoxide-style jump list — type a fragment, search downward from the typed
 * parent, rank the best folders first — while keeping plain browsing (a query
 * ending in a separator) as an unfiltered listing of that directory.
 */

const MAX_SUGGESTIONS = 80;
const MAX_SCANNED_DIRECTORIES = 4_000;
const MAX_SEARCH_DEPTH = 3;
const MAX_MISSING_ANCESTORS = 8;

/**
 * Directories that are almost never a project root but are extremely common
 * and very large. Descending into them would spend the scan budget before
 * reaching the folders the user is actually looking for.
 */
const SKIPPED_DIRECTORY_NAMES = new Set([
  ".bzr",
  ".cache",
  ".git",
  ".hg",
  ".gradle",
  ".idea",
  ".mypy_cache",
  ".next",
  ".nuxt",
  ".pnpm-store",
  ".pytest_cache",
  ".ruff_cache",
  ".svn",
  ".terraform",
  ".tox",
  ".venv",
  ".vscode",
  "__pycache__",
  "bower_components",
  "node_modules",
  "site-packages",
  "vendor",
  "venv",
]);

interface DirectoryCandidate {
  /** Absolute path of the directory, without a trailing separator. */
  path: string;
  /** Path relative to the searched parent, using "/" separators. */
  relativePath: string;
  /** 0 for a direct child of the searched parent. */
  depth: number;
}

export function expandUserPath(path: string): string {
  if (path === "" || path === "~") return homedir();
  if (path.startsWith(`~${sep}`) || path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return isAbsolute(path) ? resolve(path) : resolve(process.cwd(), path);
}

export async function listDirectorySuggestions(query = ""): Promise<ClientFileSuggestion[]> {
  const raw = query.trim();
  const expanded = expandUserPath(raw);
  const target = isDirectoryListingQuery(raw)
    ? { base: expanded, search: "" }
    : await resolveSearchBase(expanded);
  if (target === undefined) return [];

  // Browsing shows one level, exactly like a file manager. A search term is
  // what unlocks the downward scan.
  const candidates = await collectDirectories(target.base, target.search === "" ? 0 : MAX_SEARCH_DEPTH);
  const ranked = target.search === "" ? sortByPath(candidates) : rankDirectories(candidates, target.search);
  return ranked.slice(0, MAX_SUGGESTIONS).map((candidate) => ({ path: `${candidate.path}/`, kind: "other" }));
}

function isDirectoryListingQuery(raw: string): boolean {
  return raw === "" || raw === "~" || raw.endsWith("/") || raw.endsWith("\\");
}

/**
 * Anchor the search at the deepest directory that actually exists and treat
 * everything the user typed below it as the search term. Typing
 * `~/work/playria` when `~/work` does not exist is a search for
 * `work/playria` under `~`, not an error — which is what makes partially
 * remembered paths usable.
 */
async function resolveSearchBase(expanded: string): Promise<{ base: string; search: string } | undefined> {
  const segments = [basename(expanded)];
  let base = dirname(expanded);
  for (let attempt = 0; attempt <= MAX_MISSING_ANCESTORS; attempt += 1) {
    if (await isDirectory(base)) return { base, search: segments.join("/") };
    const parent = dirname(base);
    if (parent === base) return undefined;
    segments.unshift(basename(base));
    base = parent;
  }
  return undefined;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Breadth-first so shallow directories are always gathered before the scan
 * budget can be exhausted by one deep branch.
 */
async function collectDirectories(parent: string, maxDepth: number): Promise<DirectoryCandidate[]> {
  const collected: DirectoryCandidate[] = [];
  let frontier: { path: string; relativePath: string; depth: number }[] = [{ path: parent, relativePath: "", depth: -1 }];
  let scanned = 0;

  while (frontier.length > 0 && scanned < MAX_SCANNED_DIRECTORIES) {
    const next: typeof frontier = [];
    for (const directory of frontier) {
      if (scanned >= MAX_SCANNED_DIRECTORIES) break;
      scanned += 1;
      for (const child of await readChildDirectories(directory.path)) {
        const depth = directory.depth + 1;
        const relativePath = directory.relativePath === "" ? child : `${directory.relativePath}/${child}`;
        const candidate: DirectoryCandidate = { path: join(directory.path, child), relativePath, depth };
        collected.push(candidate);
        if (depth < maxDepth && !SKIPPED_DIRECTORY_NAMES.has(child)) {
          next.push({ path: candidate.path, relativePath, depth });
        }
      }
    }
    frontier = next;
  }

  return collected;
}

async function readChildDirectories(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    // A missing or unreadable directory is a normal state while typing a path
    // that does not exist yet; it must not fail the whole suggestion request.
    return [];
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      names.push(entry.name);
      continue;
    }
    if (!entry.isSymbolicLink()) continue;
    try {
      if ((await stat(join(directory, entry.name))).isDirectory()) names.push(entry.name);
    } catch {
      // Broken symlink: not a usable project folder.
    }
  }
  return names.sort((a, b) => a.localeCompare(b));
}

function sortByPath(candidates: DirectoryCandidate[]): DirectoryCandidate[] {
  return [...candidates].sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
}

function rankDirectories(candidates: DirectoryCandidate[], search: string): DirectoryCandidate[] {
  const query = search.toLowerCase();
  return candidates
    .map((candidate) => ({ candidate, score: directoryScore(candidate, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) =>
      b.score - a.score
      || a.candidate.depth - b.candidate.depth
      || a.candidate.path.length - b.candidate.path.length
      || a.candidate.path.localeCompare(b.candidate.path))
    .map(({ candidate }) => candidate);
}

/**
 * Depth is a penalty rather than a filter: a nested exact name still beats a
 * shallow fuzzy match, but two equally good matches prefer the shallower one.
 */
function directoryScore(candidate: DirectoryCandidate, query: string): number {
  const name = basename(candidate.path).toLowerCase();
  const relativePath = candidate.relativePath.toLowerCase();
  const depthPenalty = candidate.depth * 40;

  if (name === query) return 1000 - depthPenalty;
  if (name.startsWith(query)) return 900 - depthPenalty;
  if (relativePath === query) return 880 - depthPenalty;
  if (relativePath.startsWith(query)) return 850 - depthPenalty;
  if (name.includes(query)) return 750 - depthPenalty;
  if (relativePath.includes(query)) return 650 - depthPenalty;

  const tokens = query.split(/[\s/\\-_.]+/u).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => relativePath.includes(token))) {
    return 550 + tokens.filter((token) => name.includes(token)).length * 25 - depthPenalty;
  }

  return isSubsequence(query, relativePath) ? Math.max(1, 200 - depthPenalty) : 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of needle) {
    index = haystack.indexOf(character, index);
    if (index === -1) return false;
    index += character.length;
  }
  return true;
}
