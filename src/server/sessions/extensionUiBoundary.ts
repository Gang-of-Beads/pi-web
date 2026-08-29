/**
 * What the browser is told when an extension asks for an interface PI WEB
 * cannot draw.
 *
 * The headless default resolved such calls to undefined without a word, so an
 * extension waiting on an answer believed the user chose nothing - the
 * updater's version prompt asked again at every session start, and nobody
 * could see why.
 */
export function unsupportedSurfaceNotice(surface: string): string {
  return `An extension asked for an interface PI WEB does not support (${surface}); its request was cancelled. If it keeps re-asking, answer it once from the pi TUI.`;
}
