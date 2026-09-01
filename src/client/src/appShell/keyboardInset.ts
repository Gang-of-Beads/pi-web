/**
 * Keeping the composer above the soft keyboard.
 *
 * The app shell is `position: fixed` with `height: 100dvh`. A soft keyboard
 * shrinks the *visual* viewport but leaves the layout viewport alone, and
 * `dvh` follows the layout viewport, so the shell keeps its full height and the
 * bottom of it — the composer, including the send button — ends up underneath
 * the keyboard. Measured on a 839px-tall phone viewport, the send button sat at
 * y=799 while the keyboard left only 519px visible.
 *
 * The fix is to shorten the shell by however much of it the keyboard covers.
 * That amount is not simply the keyboard height: the visual viewport can also
 * be offset by pinch-zoom or by the page being scrolled under a collapsed URL
 * bar, and those must not be mistaken for a keyboard.
 */

export interface VisualViewportLike {
  height: number;
  offsetTop: number;
}

/**
 * How much of the layout viewport is hidden below the visual viewport.
 *
 * Returns 0 when nothing is covered, so the caller can apply the result
 * unconditionally. Small differences are ignored: browsers report sub-pixel
 * and few-pixel drift during scroll momentum, and reacting to that would make
 * the layout twitch.
 */
/** Offset of the visible browser viewport inside the layout viewport. */
export function visualViewportOffsetTop(visualViewport: VisualViewportLike | undefined): number {
  const offset = visualViewport?.offsetTop;
  return offset !== undefined && Number.isFinite(offset) && offset > 0 ? offset : 0;
}

export function keyboardInset(
  layoutViewportHeight: number,
  visualViewport: VisualViewportLike | undefined,
  minimumInset = 24,
): number {
  if (visualViewport === undefined) return 0;
  if (!Number.isFinite(layoutViewportHeight) || layoutViewportHeight <= 0) return 0;
  if (!Number.isFinite(visualViewport.height) || visualViewport.height <= 0) return 0;

  // What the visual viewport leaves visible at the bottom of the layout
  // viewport. Offset matters: a viewport scrolled down covers the top, not the
  // bottom, and must not count as a keyboard.
  const visibleBottom = visualViewport.offsetTop + visualViewport.height;
  const covered = layoutViewportHeight - visibleBottom;
  if (!Number.isFinite(covered) || covered < minimumInset) return 0;
  // Never shrink the shell to nothing, however the browser reports things.
  return Math.min(covered, layoutViewportHeight);
}
