/**
 * The one classifier for what a session's activity chip says. Priority is the
 * product semantics: the most specific true state answers, and the mechanism a
 * state happens to run through (an entry mutation) must not mask it.
 */
export interface SessionActivityInputs {
  treeNavigationActive?: boolean;
  entryMutationActive?: boolean;
  isCompacting?: boolean;
  isBashRunning?: boolean;
  isStreaming?: boolean;
  pendingMessageCount?: number;
}

export function sessionActivityLabel(inputs: SessionActivityInputs): string {
  if (inputs.treeNavigationActive === true) return "navigating session tree";
  if (inputs.isCompacting === true) return "compacting";
  if (inputs.entryMutationActive === true) return "updating session";
  if (inputs.isBashRunning === true) return "running bash";
  if (inputs.isStreaming === true) return "agent running";
  if ((inputs.pendingMessageCount ?? 0) > 0) return "queued";
  return "active";
}
