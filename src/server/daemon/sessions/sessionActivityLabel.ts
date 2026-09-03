/**
 * The one classifier for what a session's activity chip says. Priority is the
 * product semantics: the most specific true state answers, and the mechanism a
 * state happens to run through (an entry mutation) must not mask it.
 *
 * Compacting is not exclusive with the work the reader is waiting for -
 * `isCompacting` and `isStreaming` are independent - so it qualifies the chip
 * rather than replacing it. Announcing only "compacting" while a reply was
 * streaming read as the reply having stopped.
 */
export interface SessionActivityInputs {
  treeNavigationActive?: boolean;
  entryMutationActive?: boolean;
  isCompacting?: boolean;
  isBashRunning?: boolean;
  isStreaming?: boolean;
  pendingMessageCount?: number;
}

function primaryActivity(inputs: SessionActivityInputs): string | undefined {
  if (inputs.isBashRunning === true) return "running bash";
  if (inputs.isStreaming === true) return "agent running";
  if ((inputs.pendingMessageCount ?? 0) > 0) return "queued";
  return undefined;
}

export function sessionActivityLabel(inputs: SessionActivityInputs): string {
  if (inputs.treeNavigationActive === true) return "navigating session tree";
  const primary = primaryActivity(inputs);
  if (inputs.isCompacting === true) return primary === undefined ? "compacting" : `${primary} · compacting`;
  if (primary !== undefined) return primary;
  if (inputs.entryMutationActive === true) return "updating session";
  return "active";
}
