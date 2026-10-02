import type { FileContentResponse, FileTreeEntry, FileTreeResponse } from "@gang-of-beads/pi-web/plugin-api";

/**
 * The file explorer's state machine, owned by the plugin: the tree, expanded
 * directories, the selected file and its content, and the stale flag a settled
 * session turn raises. Requests carry identity and generation guards so a slow
 * answer from a workspace the reader already left can never land.
 */
export interface FilesExplorerIdentity {
  machineId: string;
  projectId: string;
  workspaceId: string;
}

export interface FilesExplorerSnapshot {
  tree: FileTreeEntry[];
  treeFailed: string | undefined;
  stale: boolean;
  expandedDirs: Record<string, FileTreeEntry[]>;
  selectedFilePath: string | undefined;
  selectedFileContent: FileContentResponse | undefined;
  selectedFileLoadError: string | undefined;
}

export interface FilesExplorerDeps {
  listFiles(path: string): Promise<FileTreeResponse>;
  readFile(path: string): Promise<FileContentResponse>;
  writeSelectionToUrl(path: string | undefined): void;
  readSelectionFromUrl(): string | undefined;
  describeError(error: unknown): string;
  onChange(): void;
}

export function explorerIdentityKey(identity: FilesExplorerIdentity): string {
  return `${identity.machineId}:${identity.projectId}:${identity.workspaceId}`;
}

/** How a tree read ended. A read that failed keeps the last tree and says why in `treeFailed`. */
export type TreeReadOutcome = "landed" | "failed";

export class FilesExplorer {
  private snapshot: FilesExplorerSnapshot = emptySnapshot();
  private reading: Promise<TreeReadOutcome> | undefined;
  private readAgain = false;
  private identity: FilesExplorerIdentity = { machineId: "", projectId: "", workspaceId: "" };
  private fileRequestGeneration = 0;

  constructor(private readonly deps: FilesExplorerDeps) {}

  get state(): FilesExplorerSnapshot {
    return this.snapshot;
  }

  get currentIdentity(): FilesExplorerIdentity {
    return this.identity;
  }

  /** Adopt a workspace identity; a change resets everything and restores the deep-linked selection. */
  adopt(identity: FilesExplorerIdentity): void {
    if (explorerIdentityKey(identity) === explorerIdentityKey(this.identity)) return;
    this.identity = identity;
    this.fileRequestGeneration += 1;
    this.snapshot = emptySnapshot();
    void this.refresh();
    this.restoreFromUrl();
    this.deps.onChange();
  }

  markStale(): void {
    if (this.snapshot.tree.length === 0 && this.snapshot.treeFailed === undefined) return;
    if (this.snapshot.stale) return;
    this.snapshot = { ...this.snapshot, stale: true };
    this.deps.onChange();
  }

  /**
   * Read the tree and the folders the reader has open, one read at a time: a
   * refresh asked while a read is on its way waits for it and reads once more,
   * so the newest state lands and an older listing never settles over a newer
   * one. Overlapping reads used to start a wave per request and drop all but
   * the newest; once Files read every few seconds, a machine slower than the
   * interval never landed any (review of a9968cd2, as Git's `statusReadAgain`).
   */
  refresh(): Promise<TreeReadOutcome> {
    if (this.reading === undefined) this.reading = this.readUntilCurrent();
    else this.readAgain = true;
    return this.reading;
  }

  private async readUntilCurrent(): Promise<TreeReadOutcome> {
    try {
      let outcome = await this.readTree();
      while (this.takeReadAgain()) outcome = await this.readTree();
      return outcome;
    } finally {
      this.reading = undefined;
    }
  }

  private takeReadAgain(): boolean {
    const again = this.readAgain;
    this.readAgain = false;
    return again;
  }

  private async readTree(): Promise<TreeReadOutcome> {
    let root: FileTreeResponse;
    try {
      root = await this.deps.listFiles("");
    } catch (error) {
      this.snapshot = { ...this.snapshot, treeFailed: this.deps.describeError(error) };
      this.deps.onChange();
      return "failed";
    }
    const paths = Object.keys(this.snapshot.expandedDirs);
    const listings = await Promise.allSettled(paths.map((path) => this.deps.listFiles(path)));
    const read = new Map(paths.map((path, index) => {
      const listing = listings[index];
      return [path, listing?.status === "fulfilled" ? listing.value.entries : "failed" as const];
    }));
    const expandedDirs = foldersAfterRead(this.snapshot.expandedDirs, root.entries, read);
    this.snapshot = { ...this.snapshot, tree: root.entries, expandedDirs, stale: false, treeFailed: undefined };
    if (selectedFileVerdict(this.snapshot) === "changed") void this.reloadSelectedFile();
    this.deps.onChange();
    return "landed";
  }

  async expandDir(path: string): Promise<void> {
    if (this.snapshot.expandedDirs[path] !== undefined) {
      const expandedDirs = Object.fromEntries(Object.entries(this.snapshot.expandedDirs).filter(([key]) => key !== path));
      this.snapshot = { ...this.snapshot, expandedDirs };
      this.deps.onChange();
      return;
    }
    try {
      const response = await this.deps.listFiles(path);
      this.snapshot = { ...this.snapshot, expandedDirs: { ...this.snapshot.expandedDirs, [path]: response.entries } };
    } catch {
      // A directory that fails to expand keeps its collapsed state; the tree
      // stays honest about what it could read.
    }
    this.deps.onChange();
  }

  selectFile(path: string): void {
    this.snapshot = {
      ...this.snapshot,
      selectedFilePath: path,
      selectedFileContent: undefined,
      selectedFileLoadError: undefined,
    };
    this.deps.writeSelectionToUrl(path);
    void this.loadFile(path);
  }

  /** Re-read the selected file, e.g. after an upload replaced it. */
  async reloadSelectedFile(): Promise<void> {
    const path = this.snapshot.selectedFilePath;
    if (path !== undefined) await this.loadFile(path);
  }

  restoreFromUrl(): void {
    const linked = this.deps.readSelectionFromUrl();
    if (linked === undefined || linked === "") return;
    this.snapshot = { ...this.snapshot, selectedFilePath: linked, selectedFileContent: undefined, selectedFileLoadError: undefined };
    void this.loadFile(linked);
  }

  private async loadFile(path: string): Promise<void> {
    const generation = ++this.fileRequestGeneration;
    const identity = this.identity;
    this.deps.onChange();
    try {
      const content = await this.deps.readFile(path);
      if (!this.isCurrentFileRequest(generation, identity, path)) return;
      this.snapshot = { ...this.snapshot, selectedFilePath: path, selectedFileContent: content, selectedFileLoadError: undefined };
    } catch (error) {
      if (!this.isCurrentFileRequest(generation, identity, path)) return;
      this.snapshot = { ...this.snapshot, selectedFilePath: path, selectedFileContent: undefined, selectedFileLoadError: this.deps.describeError(error) };
    }
    this.deps.onChange();
  }

  private isCurrentFileRequest(generation: number, identity: FilesExplorerIdentity, path: string): boolean {
    return generation === this.fileRequestGeneration
      && this.snapshot.selectedFilePath === path
      && explorerIdentityKey(identity) === explorerIdentityKey(this.identity);
  }
}

/** What a fresh listing says about the open file. */
export type SelectedFileVerdict = "unchanged" | "changed" | "unknown";

/**
 * Whether the open file moved on disk, judged from the listing a read just
 * brought. A read used to refresh the tree and leave the viewer on the
 * content it first loaded, so a file the agent rewrote stayed old on screen
 * while the tree beside it was new. A file's listing entry carries the same
 * `modifiedAt` the file read reports, so the content is re-read only when it
 * changed or vanished from a folder the read holds. A folder the read does not
 * hold says nothing, and nothing is re-read.
 *
 * Two entries cannot answer and are re-read on every read instead (review of
 * a9968cd2): a symlink, whose listing reports the link and not the file it
 * points to; and an open file whose last read failed but which the listing
 * still shows, so a failure that passed does not leave the error on screen.
 */
export function selectedFileVerdict(snapshot: FilesExplorerSnapshot): SelectedFileVerdict {
  const path = snapshot.selectedFilePath;
  if (path === undefined) return "unknown";
  const listing = listingOf(snapshot, parentFolder(path));
  if (listing === undefined) return "unknown";
  const entry = listing.find((candidate) => candidate.path === path);
  const loaded = snapshot.selectedFileContent;
  if (loaded === undefined) return snapshot.selectedFileLoadError !== undefined && entry !== undefined ? "changed" : "unknown";
  if (entry === undefined || entry.type === "symlink") return "changed";
  if (entry.modifiedAt === undefined) return "unknown";
  return entry.modifiedAt === loaded.modifiedAt ? "unchanged" : "changed";
}

function parentFolder(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function listingOf(snapshot: FilesExplorerSnapshot, folder: string): FileTreeEntry[] | undefined {
  return folder === "" ? snapshot.tree : snapshot.expandedDirs[folder];
}

/**
 * The open folders once a read has landed. A folder takes what the read
 * brought. One whose listing failed keeps what it showed, unless the read
 * shows it gone from its parent: an expanded folder the agent deleted used to
 * fail every later read, so the whole tree froze (review of a9968cd2).
 * Folders opened or closed while the read was on its way stay as the reader
 * left them.
 */
export function foldersAfterRead(
  open: Readonly<Record<string, FileTreeEntry[]>>,
  root: readonly FileTreeEntry[],
  read: ReadonlyMap<string, FileTreeEntry[] | "failed">,
): Record<string, FileTreeEntry[]> {
  const listed = (folder: string): readonly FileTreeEntry[] | undefined => {
    if (folder === "") return root;
    const listing = read.get(folder);
    return listing === "failed" ? undefined : listing;
  };
  const kept: Record<string, FileTreeEntry[]> = {};
  for (const [path, shown] of Object.entries(open)) {
    const listing = read.get(path);
    if (listing !== undefined && listing !== "failed") {
      kept[path] = listing;
      continue;
    }
    const parent = listed(parentFolder(path));
    if (listing === "failed" && parent !== undefined && !parent.some((entry) => entry.path === path)) continue;
    kept[path] = shown;
  }
  return kept;
}

function emptySnapshot(): FilesExplorerSnapshot {
  return {
    tree: [],
    treeFailed: undefined,
    stale: false,
    expandedDirs: {},
    selectedFilePath: undefined,
    selectedFileContent: undefined,
    selectedFileLoadError: undefined,
  };
}
