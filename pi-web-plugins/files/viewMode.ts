/**
 * The view-mode seam, carried over from the core viewer: raw source is the
 * default, a deep link wins once and becomes the device preference, and the
 * displayed mode is published back to the address bar so a copied link
 * reproduces the view. The namespace and storage key are wire format shared
 * with links saved before the extraction.
 */
export type WorkspaceFileViewMode = "preview" | "raw";

export const DEFAULT_WORKSPACE_FILE_VIEW_MODE: WorkspaceFileViewMode = "raw";
export const WORKSPACE_FILE_VIEW_MODE_STORAGE_KEY = "pi-web.workspace.files.viewMode";
export const WORKSPACE_FILE_VIEW_MODE_QUERY_KEY = "mode";
export const FILES_ROUTE_NAMESPACE = "core.workspace.files";

export type WorkspaceFileViewModeStorage = Pick<Storage, "getItem" | "setItem">;

export interface WorkspaceFileViewModeRoute {
  read(): string | undefined;
  write(mode: WorkspaceFileViewMode): void;
}

export interface WorkspaceFileViewModeStore {
  adopt(): WorkspaceFileViewMode;
  publish(mode: WorkspaceFileViewMode): void;
}

export function parseWorkspaceFileViewMode(value: string | null | undefined): WorkspaceFileViewMode | undefined {
  return value === "preview" || value === "raw" ? value : undefined;
}

export function adoptWorkspaceFileViewMode(
  route: WorkspaceFileViewModeRoute,
  storage: WorkspaceFileViewModeStorage | undefined,
): WorkspaceFileViewMode {
  const linked = parseWorkspaceFileViewMode(route.read());
  if (linked !== undefined) {
    writeStoredWorkspaceFileViewMode(linked, storage);
    return linked;
  }
  return readStoredWorkspaceFileViewMode(storage) ?? DEFAULT_WORKSPACE_FILE_VIEW_MODE;
}

export function publishWorkspaceFileViewMode(
  mode: WorkspaceFileViewMode,
  route: WorkspaceFileViewModeRoute,
  storage: WorkspaceFileViewModeStorage | undefined,
): void {
  writeStoredWorkspaceFileViewMode(mode, storage);
  route.write(mode);
}

export function readStoredWorkspaceFileViewMode(storage: WorkspaceFileViewModeStorage | undefined): WorkspaceFileViewMode | undefined {
  if (storage === undefined) return undefined;
  try {
    return parseWorkspaceFileViewMode(storage.getItem(WORKSPACE_FILE_VIEW_MODE_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function writeStoredWorkspaceFileViewMode(mode: WorkspaceFileViewMode, storage: WorkspaceFileViewModeStorage | undefined): void {
  if (storage === undefined) return;
  try {
    storage.setItem(WORKSPACE_FILE_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage quota/privacy errors; the mode still applies to this tab.
  }
}

export function createStore(ui: { query: { read(namespace: string, key: string): string | undefined; write(namespace: string, key: string, value: string | undefined, options?: { replace?: boolean }): void } }): WorkspaceFileViewModeStore {
  return {
    adopt: () => adoptWorkspaceFileViewMode(browserRoute(ui), browserStorage()),
    publish: (mode) => { publishWorkspaceFileViewMode(mode, browserRoute(ui), browserStorage()); },
  };
}

function browserRoute(ui: Parameters<typeof createStore>[0]): WorkspaceFileViewModeRoute {
  return {
    read: () => (typeof window === "undefined" ? undefined : ui.query.read(FILES_ROUTE_NAMESPACE, WORKSPACE_FILE_VIEW_MODE_QUERY_KEY)),
    write: (mode) => {
      if (typeof window === "undefined") return;
      ui.query.write(FILES_ROUTE_NAMESPACE, WORKSPACE_FILE_VIEW_MODE_QUERY_KEY, mode, { replace: true });
    },
  };
}

function browserStorage(): WorkspaceFileViewModeStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
