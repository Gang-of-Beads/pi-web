import { machineSessionKey } from "./machineKeys";

/**
 * The session one composer visit is writing for: the machine and session that
 * pick its stored draft. One `<prompt-editor>` is reused across sessions and
 * machines, so a plugin's late write must carry the scope it started in.
 */
export interface ComposerScope {
  readonly machineId: string;
  readonly sessionId: string | undefined;
}

/**
 * Where a write bound to one scope lands now.
 *
 * - `editor`: the composer still shows that scope, so the write is applied live.
 * - `storedDraft`: the composer moved on or unmounted; the text goes into that
 *   scope's stored draft, where the reader finds it on coming back, instead of
 *   into whichever session the composer shows now.
 * - `dropped`: the scope has no stored draft (no session yet) and is not shown.
 */
export type ComposerWriteTarget =
  | { kind: "editor" }
  | { kind: "storedDraft"; draftKey: string }
  | { kind: "dropped" };

export function composerWriteTarget(bound: ComposerScope, shown: ComposerScope | undefined): ComposerWriteTarget {
  if (shown !== undefined && sameComposerScope(bound, shown)) return { kind: "editor" };
  const draftKey = draftStorageKey(bound.machineId, bound.sessionId);
  return draftKey === undefined ? { kind: "dropped" } : { kind: "storedDraft", draftKey };
}

export function sameComposerScope(left: ComposerScope, right: ComposerScope): boolean {
  return left.machineId === right.machineId && left.sessionId === right.sessionId;
}

/**
 * Sessions that got another id while staying the same session, by the machine-qualified key of the
 * id they had: a new session shown while it was still starting, then given its real id, and a
 * browser-cached new session the machine no longer had, started again. Its draft, held attachments
 * and outbox move to the new id (moveDraft), so a write bound to the old id, such as a dictation
 * spanning the change or words Stop hands back, belongs to the new one. Kept for the page's
 * lifetime: one small entry per such session, and an id is never reused.
 */
const renamedSessions = new Map<string, { readonly machineId: string; readonly sessionId: string }>();

/** Records the rename; a session renamed again (a started session recreated later) is followed to its latest id. */
export function renameComposerScope(machineId: string, fromSessionId: string, toSessionId: string): void {
  const renamed = { machineId, sessionId: toSessionId };
  for (const [key, target] of renamedSessions) {
    if (target.machineId === machineId && target.sessionId === fromSessionId) renamedSessions.set(key, renamed);
  }
  renamedSessions.set(machineSessionKey(machineId, fromSessionId), renamed);
}

/** The id a session has now: itself unless it was renamed (renameComposerScope). The machine never changes. */
export function renamedSessionId(machineId: string, sessionId: string): string {
  return renamedSessions.get(machineSessionKey(machineId, sessionId))?.sessionId ?? sessionId;
}

export function currentComposerScope(scope: ComposerScope): ComposerScope {
  if (scope.sessionId === undefined || scope.sessionId === "" || scope.machineId === "") return scope;
  return { machineId: scope.machineId, sessionId: renamedSessionId(scope.machineId, scope.sessionId) };
}

export function draftStorageKey(machineId: unknown, sessionId: unknown): string | undefined {
  if (typeof machineId !== "string" || machineId === "") return undefined;
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  return machineSessionKey(machineId, sessionId);
}
