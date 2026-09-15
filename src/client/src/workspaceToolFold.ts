/**
 * Whether a workspace tool's toolbar fold is open.
 *
 * The owner's ruling: the host owns the fold, every tool panel folds the
 * same way, and each tool remembers its own last state. Collapsed is the
 * default so a page opens on its content, not its controls. Storage is one
 * key per tool id; an unreadable store reads as "never opened" rather than
 * throwing into the render.
 */
export type WorkspaceToolFoldState = "open" | "collapsed";

export interface WorkspaceToolFoldStore {
  read(toolId: string): WorkspaceToolFoldState;
  write(toolId: string, state: WorkspaceToolFoldState): void;
}

const STORAGE_PREFIX = "pi-web.workspace-tool-fold:";

export function workspaceToolFoldVerdict(stored: string | null | undefined): WorkspaceToolFoldState {
  return stored === "open" ? "open" : "collapsed";
}

export function toggledFold(state: WorkspaceToolFoldState): WorkspaceToolFoldState {
  return state === "open" ? "collapsed" : "open";
}

export function createWorkspaceToolFoldStore(storage: Pick<Storage, "getItem" | "setItem"> | undefined): WorkspaceToolFoldStore {
  return {
    read: (toolId) => {
      try {
        return workspaceToolFoldVerdict(storage?.getItem(`${STORAGE_PREFIX}${toolId}`));
      } catch {
        return "collapsed";
      }
    },
    write: (toolId, state) => {
      try {
        storage?.setItem(`${STORAGE_PREFIX}${toolId}`, state);
      } catch {
        return;
      }
    },
  };
}

export function browserWorkspaceToolFoldStore(): WorkspaceToolFoldStore {
  return createWorkspaceToolFoldStore(typeof localStorage === "undefined" ? undefined : localStorage);
}
