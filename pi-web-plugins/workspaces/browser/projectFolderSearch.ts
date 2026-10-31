import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { FileSuggestion, ProjectFolderContents, ProjectFolderEntry, ProjectFolderListing } from "@gang-of-beads/pi-web/plugin-api";
import { describeError } from "./errors";
import { fuzzyRank, fuzzyScore } from "./fuzzyMatch";

/**
 * The folder browser's quick search (r171): one query typed under the folder being shown,
 * answered in two sections. The listing's own subfolders are filtered on the page at once; the
 * machine's downward folder search, anchored at the shown folder and three levels deep, fills the
 * deeper section when it answers.
 *
 * The deeper answer carries the folder and query it was asked for, and only the latest request may
 * write it, so a reply for an older keystroke or another folder never paints. Until the answer for
 * the folder and query on screen arrives, the section reads as searching, never as empty. The
 * debounce and abort mirror the dialog's typed-path suggestions.
 */

const DEEPER_SEARCH_DEBOUNCE_MS = 120;

/** A deeper result: the folder, and where it sits below the folder being shown. */
export interface DeeperFolder extends ProjectFolderEntry {
  readonly location: string;
}

/** The deeper section's state; `skipped` is a query the machine was not asked about, which claims nothing. */
export type DeeperAnswer =
  | { readonly kind: "searching" }
  | { readonly kind: "answered"; readonly folders: readonly DeeperFolder[] }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "skipped" };

interface DeeperSearch {
  readonly folder: string;
  readonly query: string;
  readonly answer: DeeperAnswer;
}

type Directories = (query: string, signal: AbortSignal) => Promise<FileSuggestion[]>;

const SEARCHING: DeeperAnswer = { kind: "searching" };

/** The subfolders a listing found, or undefined for a folder that is missing or could not be read. */
export function listedFolders(contents: ProjectFolderContents): readonly ProjectFolderEntry[] | undefined {
  return "folders" in contents ? contents.folders : undefined;
}

/** The listing's own subfolders that match `query`, best first. */
export function matchingSubfolders(listing: ProjectFolderListing, query: string): ProjectFolderEntry[] {
  return fuzzyRank(listedFolders(listing.contents) ?? [], query, (folder) => folder.name);
}

function searchAnchor(listing: ProjectFolderListing): string {
  return listing.path.endsWith(listing.separator) ? listing.path : `${listing.path}${listing.separator}`;
}

/**
 * The machine's ranked folders as deeper rows: each named by its last segment and located relative
 * to the shown folder. An immediate child the listing shows is dropped, since the first section
 * shows it; one the listing does not hold (past its first 500, or a linked folder a slow listing
 * did not check) stays, or a big folder answered "No folders match" for a subfolder it has. A path
 * outside the shown folder is located by its whole path. The machine ends every suggestion with
 * `/`, also where its own separator is `\`, so either trailing mark is dropped. The machine matches
 * loosely across the whole relative path, which listed folders whose names hold nothing of the
 * query (a `.git` inside a matching folder, a task folder whose path spells the query out); a name
 * query keeps only rows whose name matches it as the first section matches, and a query with a
 * separator in it stays the machine's to answer.
 */
function deeperFolders(suggestions: readonly FileSuggestion[], listing: ProjectFolderListing, query: string): DeeperFolder[] {
  const { separator } = listing;
  const anchor = searchAnchor(listing);
  const listed = new Set((listedFolders(listing.contents) ?? []).map((folder) => folder.path));
  const byName = !/[\\/]/u.test(query);
  return suggestions.flatMap((suggestion) => {
    const path = withoutTrailingMark(suggestion.path, separator);
    const inside = path.startsWith(anchor);
    const location = inside ? path.slice(anchor.length) : path;
    if (inside && !location.includes(separator) && listed.has(path)) return [];
    const name = path.slice(path.lastIndexOf(separator) + separator.length);
    if (byName && fuzzyScore(name, query) === undefined) return [];
    return [{ name, path, location }];
  });
}

/**
 * A query with a `.` or `..` segment, joined to the shown folder, names that folder or one above it
 * rather than a search under it: a lone `.`, the first key of every hidden folder's name, made the
 * machine search the parent folder for the shown folder's own name.
 */
function climbsOut(query: string): boolean {
  return query.split(/[\\/]/u).some((segment) => segment === "." || segment === "..");
}

function withoutTrailingMark(path: string, separator: string): string {
  if (path.endsWith(separator)) return path.slice(0, -separator.length);
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

export class ProjectFolderSearch implements ReactiveController {
  /** The query as typed; the sections show while it has more than whitespace. */
  query = "";
  private deeper: DeeperSearch | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | undefined;
  private requestId = 0;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly directories: () => Directories | undefined,
  ) {
    host.addController(this);
  }

  hostDisconnected(): void {
    this.stop();
  }

  get active(): boolean {
    return this.query.trim() !== "";
  }

  /** The deeper answer for this listing and the query on screen; anything else is still searching. */
  deeperAnswer(listing: ProjectFolderListing): DeeperAnswer {
    const deeper = this.deeper;
    if (deeper?.folder !== listing.path || deeper.query !== this.query.trim()) return SEARCHING;
    return deeper.answer;
  }

  /** The row Enter in the field opens: the first match in the listing, else the first deeper one; none for an empty query. */
  firstResult(listing: ProjectFolderListing): ProjectFolderEntry | undefined {
    if (!this.active) return undefined;
    const deeper = this.deeperAnswer(listing);
    return matchingSubfolders(listing, this.query)[0] ?? (deeper.kind === "answered" ? deeper.folders[0] : undefined);
  }

  type(query: string, listing: ProjectFolderListing): void {
    this.stop();
    this.query = query;
    this.deeper = undefined;
    this.host.requestUpdate();
    if (!this.active) return;
    if (climbsOut(query.trim())) {
      this.deeper = { folder: listing.path, query: query.trim(), answer: { kind: "skipped" } };
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.searchDeeper(listing, query.trim());
    }, DEEPER_SEARCH_DEBOUNCE_MS);
  }

  clear(): void {
    this.stop();
    this.query = "";
    this.deeper = undefined;
    this.host.requestUpdate();
  }

  private async searchDeeper(listing: ProjectFolderListing, query: string): Promise<void> {
    const requestId = ++this.requestId;
    const abort = new AbortController();
    this.abort = abort;
    const scope = { folder: listing.path, query };
    try {
      const directories = this.directories();
      if (directories === undefined) throw new Error("Folder search is not available here");
      const suggestions = await directories(`${searchAnchor(listing)}${query}`, abort.signal);
      if (requestId !== this.requestId) return;
      this.deeper = { ...scope, answer: { kind: "answered", folders: deeperFolders(suggestions, listing, query) } };
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.deeper = { ...scope, answer: { kind: "failed", reason: describeError(error) } };
    }
    this.abort = undefined;
    this.host.requestUpdate();
  }

  private stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.abort?.abort();
    this.abort = undefined;
    this.requestId += 1;
  }
}
