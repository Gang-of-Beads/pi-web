/**
 * Fold a cumulative dictation report into the draft it belongs to.
 *
 * Live dictation reports everything it has heard so far on every update, so the
 * draft is the typed text plus the latest report - not the typed text plus
 * every report, which is what appending produced.
 *
 * The typed text is the part the user owns and is never rewritten here.
 */
export function draftWithDictation(typed: string, dictated: string): string {
  if (dictated === "") return typed;
  if (typed === "") return dictated;
  const separator = typed.endsWith(" ") || typed.endsWith("\n") ? "" : " ";
  return `${typed}${separator}${dictated}`;
}
