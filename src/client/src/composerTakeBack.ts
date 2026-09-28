/**
 * How a message handed back to the composer meets what the reader is already typing.
 *
 * Discard, recall, stop and "edit and send again" all return a message. Replacing the
 * composer destroyed a half-typed draft with no copy left anywhere - two review lanes
 * reproduced it on a thumb that missed Retry - so an empty composer receives the message
 * as it was, and a busy one keeps its words first with the returned text after them.
 */
export function joinTakenBack(current: string, returned: string): string {
  if (current.trim() === "") return returned;
  if (returned.trim() === "") return current;
  return `${current.replace(/\s+$/u, "")}\n\n${returned}`;
}
