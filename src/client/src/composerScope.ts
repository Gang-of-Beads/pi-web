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
  if (shown?.machineId === bound.machineId && shown.sessionId === bound.sessionId) return { kind: "editor" };
  const draftKey = draftStorageKey(bound.machineId, bound.sessionId);
  return draftKey === undefined ? { kind: "dropped" } : { kind: "storedDraft", draftKey };
}

export function draftStorageKey(machineId: unknown, sessionId: unknown): string | undefined {
  if (typeof machineId !== "string" || machineId === "") return undefined;
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  return machineSessionKey(machineId, sessionId);
}
