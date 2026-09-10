/**
 * The interrupted-runs read is a read-and-clear exchange with the daemon, so
 * its outcome has to be interpreted, not applied verbatim: after the boot
 * read has spent the record, every later answer is empty, and an empty answer
 * says nothing about the markers already on screen. This is the whole
 * decision in one testable place — the round-25 fix moved the flag write but
 * left the retraction behind an early return, which is how a claimed fix
 * ships twice without reaching the reader.
 */
export interface InterruptedRunsReadPlan {
  /** A failed read is not a record: the daemon may still hold markers. */
  failed: boolean;
  /** Replace the on-screen marker set with the read's (possibly empty) set. */
  adoptMarkers: boolean;
  /** A successful read answers the unknown-state banner, empty or not. */
  resolveUnknown: boolean;
}

export function interruptedRunsReadPlan(ids: ReadonlySet<string> | undefined, adoptEmpty: boolean): InterruptedRunsReadPlan {
  if (ids === undefined) return { failed: true, adoptMarkers: false, resolveUnknown: false };
  return { failed: false, adoptMarkers: ids.size > 0 || adoptEmpty, resolveUnknown: true };
}
