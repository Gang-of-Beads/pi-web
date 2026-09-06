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

export class FilesExplorer {
  private snapshot: FilesExplorerSnapshot = emptySnapshot();
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

  async refresh(): Promise<void> {
    try {
      const root = await this.deps.listFiles("");
      const expanded: Record<string, FileTreeEntry[]> = {};
      for (const path of Object.keys(this.snapshot.expandedDirs)) {
        expanded[path] = (await this.deps.listFiles(path)).entries;
      }
      this.snapshot = { ...this.snapshot, tree: root.entries, expandedDirs: expanded, stale: false, treeFailed: undefined };
    } catch (error) {
      this.snapshot = { ...this.snapshot, treeFailed: this.deps.describeError(error) };
    }
    this.deps.onChange();
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
