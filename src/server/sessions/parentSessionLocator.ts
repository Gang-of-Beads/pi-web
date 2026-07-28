import { canonicalizeStoredCwd, cwdPathsEqual } from "../workingDirectory.js";
import type { SessionHeaderSummary } from "./sessionFileHeader.js";

/** Reads a session file header; injected so locating parents is testable without a filesystem. */
export type SessionHeaderReader = (sessionFile: string) => Promise<SessionHeaderSummary | undefined>;

/** The subset of a listed session this locator needs. */
export interface ParentLocatableSession {
  path: string;
  parentSessionPath?: string;
}

/** Where an out-of-listing parent session lives, as far as its file header reveals. */
export interface ParentSessionLocation {
  parentSessionId: string;
  parentSessionCwd: string;
}

/**
 * Locate the parents of `sessions` that live in a different working directory,
 * keyed by the `parentSessionPath` the child recorded.
 *
 * Sessions are listed per working directory, so a child spawned into another
 * worktree of the same project has a `parentSessionPath` that resolves to
 * nothing in its own list. The parent's cwd and id are recorded in the parent
 * session file's header, so one small header read per distinct missing parent is
 * enough to point at it — no cross-workspace listing required.
 *
 * Parents already present in `sessions` are skipped without a read: they are
 * linkable by path already, so the IO would buy nothing. Headers for a given
 * path are immutable in practice, so `readHeader` is free to cache; this
 * function stays stateless.
 */
export async function locateOutOfListingParents(
  sessions: readonly ParentLocatableSession[],
  listingCwd: string,
  readHeader: SessionHeaderReader,
): Promise<Map<string, ParentSessionLocation>> {
  const located = new Map<string, ParentSessionLocation>();
  for (const parentSessionPath of missingParentPaths(sessions)) {
    const location = await parentLocation(parentSessionPath, readHeader);
    // A parent sharing the listing's cwd is not "elsewhere": it is absent for
    // some other reason (archived and moved, or simply not listed), and offering
    // a jump to this same workspace would not help.
    if (location === undefined || cwdPathsEqual(location.parentSessionCwd, listingCwd)) continue;
    located.set(parentSessionPath, location);
  }
  return located;
}

/** Distinct recorded parent paths that no session in the listing occupies. */
function missingParentPaths(sessions: readonly ParentLocatableSession[]): Set<string> {
  const listedPaths = new Set(sessions.map((session) => canonicalizeStoredCwd(session.path)));
  const missing = new Set<string>();
  for (const session of sessions) {
    const parentSessionPath = session.parentSessionPath;
    if (parentSessionPath === undefined || parentSessionPath === "") continue;
    if (listedPaths.has(canonicalizeStoredCwd(parentSessionPath))) continue;
    missing.add(parentSessionPath);
  }
  return missing;
}

/**
 * A parent whose header is unreadable or carries no cwd (very old session files)
 * has no reportable location, so the browser keeps saying only that the parent is
 * unavailable.
 */
async function parentLocation(parentSessionPath: string, readHeader: SessionHeaderReader): Promise<ParentSessionLocation | undefined> {
  const header = await readHeader(parentSessionPath);
  if (header?.cwd === undefined) return undefined;
  return { parentSessionId: header.id, parentSessionCwd: canonicalizeStoredCwd(header.cwd) };
}

/**
 * Count, per listed session path, how many sessions outside this listing record
 * it as their parent, so a parent row can show that it has children that are not
 * visible beneath it.
 *
 * Children are identified only by the parent session *file* path they recorded,
 * which is exactly the link Pi writes into the child header; neither a header
 * read of the parent nor the child's own location is required.
 */
export function countOutOfListingChildren(
  sessions: readonly ParentLocatableSession[],
  childParentSessionPaths: readonly string[],
): Map<string, number> {
  const listedPaths = new Map(sessions.map((session) => [canonicalizeStoredCwd(session.path), session.path]));
  const counts = new Map<string, number>();
  for (const parentSessionPath of childParentSessionPaths) {
    const listedPath = listedPaths.get(canonicalizeStoredCwd(parentSessionPath));
    if (listedPath === undefined) continue;
    counts.set(listedPath, (counts.get(listedPath) ?? 0) + 1);
  }
  return counts;
}
