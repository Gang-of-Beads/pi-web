import { browserLocalStorage } from "./browserLocalStorage";

/**
 * Which sections of a session list the reader folded, per list (owner, 2026-10-04: every list
 * remembers its own). Stored on this device only; a section the reader never touched takes its
 * definition's default (Archived starts folded).
 */
export type SessionListName = "navigate" | "quick-switcher";

const STORAGE_PREFIX = "pi-web.list-folds.";

export interface ListFolds {
  isFolded(sectionId: string, foldedByDefault: boolean): boolean;
  toggle(sectionId: string, foldedByDefault: boolean): void;
}

export function listFolds(list: SessionListName, storage: Pick<Storage, "getItem" | "setItem"> | undefined = browserLocalStorage()): ListFolds {
  const key = `${STORAGE_PREFIX}${list}`;
  const read = (): Record<string, boolean> => {
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return {};
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
    } catch {
      return {};
    }
  };
  return {
    isFolded(sectionId, foldedByDefault) {
      return read()[sectionId] ?? foldedByDefault;
    },
    toggle(sectionId, foldedByDefault) {
      const folds = read();
      folds[sectionId] = !(folds[sectionId] ?? foldedByDefault);
      try {
        storage?.setItem(key, JSON.stringify(folds));
      } catch {
        return;
      }
    },
  };
}

