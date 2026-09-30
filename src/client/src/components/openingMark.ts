import { css, html, type TemplateResult } from "lit";
import { OPENING_WORDS, type PendingNavigation } from "../navigationIntent";

/**
 * The tapped item's own answer while its destination loads (D8, B29).
 *
 * The owner's case: a tap that looked like it did nothing, followed seconds later by the
 * page moving on its own. The item acknowledges the tap within one frame: a spinner in its
 * state mark's place at once, then words on its secondary line at the phase boundaries, so
 * the name keeps its room on a narrow tile. A failure says so on the item. The app speaks the
 * change once, from `navigationIntent`'s announcement, so the row itself stays quiet.
 */
export function renderOpeningSpinner(): TemplateResult {
  return html`<span class="opening-spinner" aria-hidden="true"></span>`;
}

/** The words for the item's secondary line, or undefined when the line keeps its own text. */
export function renderOpeningWords(opening: PendingNavigation | undefined, key: string): TemplateResult | undefined {
  if (opening?.key !== key) return undefined;
  const words = OPENING_WORDS[opening.phase];
  if (words === "") return undefined;
  return html`<span class=${`opening-words ${opening.phase}`}>${words}</span>`;
}

export function isOpeningKey(opening: PendingNavigation | undefined, key: string): boolean {
  return opening?.key === key && opening.phase !== "failed";
}

export const openingMarkStyles = css`
  .opening-spinner { box-sizing: border-box; display: inline-block; flex: 0 0 auto; width: var(--pi-dot-md); height: var(--pi-dot-md); border: 2px solid color-mix(in srgb, var(--pi-accent) 25%, transparent); border-top-color: var(--pi-accent); border-radius: 50%; animation: opening-spin .7s linear infinite; }
  /* Inside the secondary line it stands in for, taking that line's size and one-line box: a tile never changes height while its session opens. */
  .opening-words { color: var(--pi-accent); }
  .opening-words.failed { color: var(--pi-danger); }
  @keyframes opening-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .opening-spinner { animation: none; border-color: var(--pi-accent); }
  }
`;
