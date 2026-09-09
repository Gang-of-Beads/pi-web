import { html, type TemplateResult } from "lit";

/**
 * One chevron for "this section opens and closes".
 *
 * The chrome drew this verb as a 16px SVG while the lists spelled it with the
 * text characters "▸"/"▾", which take the font's own weight and baseline and
 * sit at whatever size their line gives them. Two glyph languages for one verb
 * on one screen is the kind of thing nobody reports and everybody sees.
 */
export function renderDisclosureIcon(collapsed: boolean): TemplateResult {
  return html`
    <svg class=${`disclosure-icon${collapsed ? " collapsed" : " expanded"}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m9 18 6-6-6-6"></path>
    </svg>
  `;
}

export const disclosureIconStyle = `
  .disclosure-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; transition: transform 120ms ease; }
  .disclosure-icon.expanded { transform: rotate(90deg); }
`;
