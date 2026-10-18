import type { SessionInfo } from "../api";
import { isPendingStartSessionInfo } from "../sessionPersistence";
import type { PluginLifecycleEvent } from "./types";

/** The session the reader has selected, on the machine it is on. */
export interface SelectedSessionAt {
  readonly machineId: string;
  readonly session: SessionInfo | undefined;
}

/**
 * The session a plugin is told is selected: a draft still starting has only a client-pending id,
 * which names nothing on its machine and is gone once the session has its real one (owner
 * decision), so it is announced as no session.
 */
function announcedSession(selection: SelectedSessionAt): { readonly machineId: string; readonly sessionId: string } | undefined {
  const session = selection.session;
  if (session === undefined || isPendingStartSessionInfo(session)) return undefined;
  return { machineId: selection.machineId, sessionId: session.id };
}

/**
 * The documented `session-left` and `session-selected` facts for a change of selection, by machine
 * and session id (a renamed folder is the same session). Leaving a session for a draft reports
 * `session-left` at once; the draft is announced once, with its real id, when it has one.
 */
export function sessionSelectionFacts(previous: SelectedSessionAt, next: SelectedSessionAt): PluginLifecycleEvent[] {
  const left = announcedSession(previous);
  const selected = announcedSession(next);
  if (left?.sessionId === selected?.sessionId && left?.machineId === selected?.machineId) return [];
  const facts: PluginLifecycleEvent[] = [];
  if (left !== undefined) facts.push({ kind: "session-left", ...left });
  if (selected !== undefined) facts.push({ kind: "session-selected", ...selected });
  return facts;
}
