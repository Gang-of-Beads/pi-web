import { html, type TemplateResult } from "lit";

/**
 * The marks the transcript and the status bar draw.
 *
 * These were typed characters - ⧉ ↻ ↩ ✓ ✖ ▶ ↑ ↓ - so each took whatever font
 * resolved it, at whatever ink size that font gave it, next to icons drawn at a
 * stated size. One message header carried both languages at once. Drawing them
 * from one place makes the size a decision rather than a font's opinion.
 */
function icon(path: TemplateResult, extraClass = ""): TemplateResult {
  return html`
    <svg class=${`ui-icon${extraClass === "" ? "" : ` ${extraClass}`}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${path}
    </svg>
  `;
}

export function renderCopyIcon(): TemplateResult {
  return icon(html`<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h8"></path>`);
}

export function renderCheckIcon(): TemplateResult {
  return icon(html`<path d="m5 12 5 5 9-10"></path>`);
}

export function renderCrossIcon(): TemplateResult {
  return icon(html`<path d="M6 6 18 18"></path><path d="M18 6 6 18"></path>`);
}

export function renderResendIcon(): TemplateResult {
  return icon(html`<path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path>`);
}

export function renderRecallIcon(): TemplateResult {
  return icon(html`<path d="M9 14 4 9l5-5"></path><path d="M4 9h10a6 6 0 0 1 0 12h-3"></path>`);
}

export function renderRunIcon(): TemplateResult {
  return icon(html`<path d="m8 5 11 7-11 7z"></path>`);
}

export function renderUpIcon(): TemplateResult {
  return icon(html`<path d="M12 19V5"></path><path d="m6 11 6-6 6 6"></path>`);
}

export function renderDownIcon(): TemplateResult {
  return icon(html`<path d="M12 5v14"></path><path d="m6 13 6 6 6-6"></path>`);
}

export function renderDoubleCheckIcon(): TemplateResult {
  return icon(html`<path d="m3 12 4 4 7-8"></path><path d="m11 16 2 2 8-10"></path>`);
}

export function renderPendingRingIcon(): TemplateResult {
  return icon(html`<circle cx="12" cy="12" r="8"></circle>`);
}

export function renderFilledDotIcon(): TemplateResult {
  return icon(html`<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"></circle>`);
}

export const uiIconStyle = `
  .ui-icon { flex: 0 0 auto; width: 14px; height: 14px; vertical-align: -0.15em; pointer-events: none; }
`;
