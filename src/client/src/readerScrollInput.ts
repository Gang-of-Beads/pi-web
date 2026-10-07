/**
 * Which inputs are the reader scrolling the transcript (D4: only the reader's intent moves the reader).
 *
 * The transcript's own movement is not enough on its own: the browser moves `scrollTop` itself when a
 * session switch swaps the content under it, and taking that for the reader ended a restore before it
 * ran (seen live on 8505 while fixing review 9f8186d0 rows 6-7). So movement counts only shortly after
 * one of these inputs, and a wheel counts only when it reaches the transcript.
 */

/**
 * A wheel over a long tool output or a card's own scroller moves that element, and only chains to the
 * transcript once the element is at its end in that direction (no card here sets
 * `overscroll-behavior: contain`, B11). A turn with no vertical part never moves the transcript.
 */
export function wheelReachesScroller(path: readonly EventTarget[], scroller: Element, deltaY: number): boolean {
  if (deltaY === 0) return false;
  for (const target of path) {
    if (target === scroller) return true;
    if (target instanceof Element && absorbsWheel(target, deltaY)) return false;
  }
  return true;
}

const SCROLLING_OVERFLOW: ReadonlySet<string> = new Set(["auto", "scroll", "overlay"]);

function absorbsWheel(element: Element, deltaY: number): boolean {
  if (element.scrollHeight <= element.clientHeight) return false;
  if (!SCROLLING_OVERFLOW.has(getComputedStyle(element).overflowY)) return false;
  return deltaY < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight - 1;
}

const SCROLL_KEYS: ReadonlySet<string> = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/**
 * A key that can scroll the page: a scroll key, unmodified, pressed outside anything editable. A focused
 * control may spend it instead (Space on a button); the window it opens is short and a switch resets it.
 */
export function isScrollKey(event: KeyboardEvent): boolean {
  if (!SCROLL_KEYS.has(event.key) || event.ctrlKey || event.metaKey || event.altKey) return false;
  const origin = event.composedPath()[0];
  if (!(origin instanceof HTMLElement)) return true;
  return !(origin.isContentEditable || origin instanceof HTMLInputElement || origin instanceof HTMLTextAreaElement || origin instanceof HTMLSelectElement);
}
