import nodePath, { type PlatformPath } from "node:path";
import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import type { ProjectFolderContents, ProjectFolderCrumb, ProjectFolderEntry, ProjectFolderListing, ProjectFolderListingRequest, ProjectFolderUnreadableCause } from "../../shared/apiTypes.js";
import { expandUserPath } from "../shared/projects/directorySuggestions.js";

/**
 * One level of one folder for the add-project folder browser (r67).
 *
 * Unlike the folder suggestions, which may hide a failure behind an empty list because they are
 * only hints, this listing is what the reader browses by, so it answers honestly: a folder it
 * could not read says why, a listing cut at the row limit says how many it holds, and one that ran
 * out of time checking linked folders says it is incomplete. Every path, parent and root comes
 * from this machine's own `node:path`, so a Windows machine answers drive roots, UNC shares and
 * backslashes while the page only shows what it was told.
 */

const PROJECT_FOLDER_LISTING_LIMIT = 500;

/**
 * The time one listing may take. A dead network mount can leave a directory read blocked in the
 * kernel indefinitely; the reader is told it timed out instead of waiting on it.
 */
const LISTING_BUDGET_MS = 3_000;

/** A new folder name this machine cannot create, with the reason in the reader's words. */
export class ProjectFolderNameError extends Error {
  override name = "ProjectFolderNameError";
}

export async function readProjectFolder(request: ProjectFolderListingRequest): Promise<ProjectFolderListing> {
  const target = projectFolderTarget(request, nodePath, expandUserPath);
  return { ...projectFolderPlace(target, nodePath), contents: await readFolderContents(target, nodePath) };
}

/** The absolute folder a request names, or the named new child under it; throws for a child name this machine cannot use. */
export function projectFolderTarget(request: ProjectFolderListingRequest, pathApi: PlatformPath, expand: (path: string) => string): string {
  const base = expand(request.path.trim());
  if (request.child === undefined) return base;
  const refusal = folderNameRefusal(request.child, pathApi);
  if (refusal !== undefined) throw new ProjectFolderNameError(FOLDER_NAME_REFUSAL_WORDS[refusal]);
  return pathApi.join(base, request.child);
}

/** The folder's place in its filesystem: parent and crumbs, computed with the machine's path rules. */
export function projectFolderPlace(target: string, pathApi: PlatformPath): Omit<ProjectFolderListing, "contents"> {
  const parent = pathApi.dirname(target);
  return { path: target, parent: parent === target ? null : parent, crumbs: folderCrumbs(target, pathApi), separator: pathApi.sep };
}

function folderCrumbs(target: string, pathApi: PlatformPath): ProjectFolderCrumb[] {
  const root = pathApi.parse(target).root;
  const crumbs: ProjectFolderCrumb[] = [{ name: root, path: root }];
  let current = root;
  for (const name of target.slice(root.length).split(pathApi.sep)) {
    if (name === "") continue;
    current = pathApi.join(current, name);
    crumbs.push({ name, path: current });
  }
  return crumbs;
}

type FolderNameRefusal = "empty" | "relative" | "separator" | "control" | "windows-character" | "windows-ending" | "windows-device";

const FOLDER_NAME_REFUSAL_WORDS: Readonly<Record<FolderNameRefusal, string>> = {
  empty: "Enter a folder name.",
  relative: "A folder cannot be named . or ..",
  separator: "A folder name cannot contain a path separator.",
  control: "A folder name cannot contain control characters.",
  "windows-character": "A folder name on Windows cannot contain < > : \" | ? or *.",
  "windows-ending": "A folder name on Windows cannot end with a dot or a space.",
  "windows-device": "That name is reserved for a device on Windows.",
};

const WINDOWS_FORBIDDEN_CHARACTER = /[<>:"|?*]/u;
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/iu;
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * Why a name cannot be one new folder on this machine, or undefined when it can. Windows' own
 * naming rules apply only when the machine is Windows: a colon or a trailing dot is a legal POSIX
 * name and is not refused there.
 */
export function folderNameRefusal(name: string, pathApi: PlatformPath): FolderNameRefusal | undefined {
  if (name.trim() === "") return "empty";
  if (name === "." || name === "..") return "relative";
  if (name.includes(pathApi.sep) || name.includes("/")) return "separator";
  if (CONTROL_CHARACTER.test(name)) return "control";
  if (pathApi.sep !== "\\") return undefined;
  if (WINDOWS_FORBIDDEN_CHARACTER.test(name)) return "windows-character";
  if (name.endsWith(".") || name.endsWith(" ")) return "windows-ending";
  return WINDOWS_DEVICE_NAME.test(name) ? "windows-device" : undefined;
}

const UNREADABLE_CAUSE_BY_ERRNO: Readonly<Record<string, ProjectFolderUnreadableCause>> = {
  ENOTDIR: "not-a-folder",
  EACCES: "denied",
  EPERM: "denied",
};

const nameOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

async function readFolderContents(target: string, pathApi: PlatformPath): Promise<ProjectFolderContents> {
  const deadline = Date.now() + LISTING_BUDGET_MS;
  const read = await settleBefore(sharedRead(`readdir:${target}`, () => readdir(target, { withFileTypes: true })), deadline);
  if (read.kind === "late") return { kind: "unreadable", cause: "timed-out" };
  if (read.kind === "failed") return unreadableContents(read.error);
  const names = read.value.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const links = await linkedFolderNames(target, read.value.filter((entry) => entry.isSymbolicLink()), pathApi, deadline);
  const folders = [...names, ...links.names]
    .sort((left, right) => nameOrder.compare(left, right))
    .slice(0, PROJECT_FOLDER_LISTING_LIMIT)
    .map((name): ProjectFolderEntry => ({ name, path: pathApi.join(target, name) }));
  if (!links.checkedAll) return { kind: "incomplete", folders };
  const total = names.length + links.names.length;
  return total > folders.length ? { kind: "truncated", folders, total } : { kind: "complete", folders };
}

function unreadableContents(error: unknown): ProjectFolderContents {
  const code = errnoOf(error);
  if (code === "ENOENT") return { kind: "missing" };
  const cause = code !== undefined && Object.hasOwn(UNREADABLE_CAUSE_BY_ERRNO, code) ? UNREADABLE_CAUSE_BY_ERRNO[code] : undefined;
  if (cause !== undefined) return { kind: "unreadable", cause };
  return { kind: "unreadable", cause: "failed", detail: code ?? (error instanceof Error ? error.message : String(error)) };
}

/**
 * The symbolic links (and Windows junctions) among the entries that lead to a folder. They are
 * checked one at a time so a link into a dead mount holds at most one filesystem thread, and the
 * check stops at the listing's deadline; a link that does not resolve (dangling, a loop, denied)
 * is not a folder this browser can enter.
 */
async function linkedFolderNames(target: string, links: readonly Dirent[], pathApi: PlatformPath, deadline: number): Promise<{ names: string[]; checkedAll: boolean }> {
  const names: string[] = [];
  for (const link of links) {
    const linked = pathApi.join(target, link.name);
    const checked = await settleBefore(sharedRead(`stat:${linked}`, () => stat(linked)), deadline);
    if (checked.kind === "late") return { names, checkedAll: false };
    if (checked.kind === "settled" && checked.value.isDirectory()) names.push(link.name);
  }
  return { names, checkedAll: true };
}

type Settled<T> = { kind: "settled"; value: T } | { kind: "failed"; error: unknown } | { kind: "late" };

async function settleBefore<T>(operation: Promise<T>, deadline: number): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Settled<T>>((resolve) => { timer = setTimeout(() => { resolve({ kind: "late" }); }, Math.max(0, deadline - Date.now())); });
  try {
    return await Promise.race([
      operation.then((value): Settled<T> => ({ kind: "settled", value }), (error: unknown): Settled<T> => ({ kind: "failed", error })),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One in-flight filesystem call per path. A call into a hung mount cannot be cancelled; sharing it
 * keeps a reader who opens the same folder again from pinning another thread on the same hang,
 * and the path is read afresh once that call settles.
 */
const inFlight = new Map<string, Promise<unknown>>();

function sharedRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const shared = inFlight.get(key);
  if (shared !== undefined) return shared.then(read, read);
  const started = read();
  inFlight.set(key, started);
  const forget = () => { if (inFlight.get(key) === started) inFlight.delete(key); };
  started.then(forget, forget);
  return started;
}

function errnoOf(error: unknown): string | undefined {
  const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" ? code : undefined;
}
