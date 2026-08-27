const draftStoragePrefix = "pi-web:prompt-draft:";

function draftStorageKey(sessionId: string): string {
  return `${draftStoragePrefix}${sessionId}`;
}

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadDraft(sessionId: string, storage = browserStorage()): string {
  try {
    return storage?.getItem(draftStorageKey(sessionId)) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(sessionId: string, draft: string, storage = browserStorage()): void {
  try {
    if (draft) storage?.setItem(draftStorageKey(sessionId), draft);
    else storage?.removeItem(draftStorageKey(sessionId));
  } catch {
    // Ignore localStorage quota/privacy errors.
  }
}

export function clearDraft(sessionId: string, storage = browserStorage()): void {
  try {
    storage?.removeItem(draftStorageKey(sessionId));
  } catch {
    // Ignore localStorage quota/privacy errors.
  }
}

export function moveDraft(fromSessionId: string, toSessionId: string, storage = browserStorage()): void {
  const draft = loadDraft(fromSessionId, storage);
  if (draft === "") return;
  saveDraft(toSessionId, draft, storage);
  clearDraft(fromSessionId, storage);
}

/**
 * Whether this render should read a stored draft back into the editor.
 *
 * Every keystroke is saved, but the draft used to be read back only when the
 * session or machine changed. A refresh builds the editor fresh, so those
 * arrive as initial values rather than changes: the guard returned before the
 * load and the typed text was gone, though it was sitting in storage.
 *
 * The first render is exactly when a draft has to be restored - that is the
 * moment the reader comes back to. Later renders must not, or the load would
 * overwrite what they are typing.
 */
export function restoresDraftOnFirstRender(state: {
  hasRendered: boolean;
  sessionChanged: boolean;
  machineChanged: boolean;
}): boolean {
  return !state.hasRendered || state.sessionChanged || state.machineChanged;
}

/**
 * Whether the editor should hand its current text back to storage first.
 *
 * Restoring reuses the path that saves the outgoing draft when the reader
 * switches session. On the first render there is nothing in the editor yet,
 * and the key it would save under is the same one it is about to read - so
 * that save would clear the draft a moment before restoring it.
 */
export function savesOutgoingDraft(state: { hasRendered: boolean }): boolean {
  return state.hasRendered;
}
