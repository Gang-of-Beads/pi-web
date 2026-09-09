import { html, type TemplateResult } from "lit";

/**
 * The marks the transcript, the status bar and the row controls draw.
 *
 * These were typed characters - ⧉ ↻ ↩ ✓ ✖ ▶ ↑ ↓ - so each took whatever font
 * resolved it, at whatever ink size that font gave it. Drawing them from one
 * place makes the size a decision rather than a font's opinion.
 *
 * Every shape is inlined in its own single template on purpose. Composing an
 * `<svg>` from a nested `html` sub-template puts the shape in the XHTML
 * namespace, where it occupies its box and paints nothing: for two rounds the
 * receipts under user messages, the copy and resend controls and the status-bar
 * arrows were blank while every geometric check agreed they were 14px and
 * centred. `uiIcons.test.ts` fails if a shape leaves the SVG namespace again.
 */
const ATTRIBUTES = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor" } as const;

export function renderCopyIcon(): TemplateResult {
  return html`<svg class="ui-icon" viewBox=${ATTRIBUTES.viewBox} aria-hidden="true" focusable="false" fill=${ATTRIBUTES.fill} stroke=${ATTRIBUTES.stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h8"></path></svg>`;
}

export function renderCheckIcon(): TemplateResult {
  return html`<svg class="ui-icon" viewBox=${ATTRIBUTES.viewBox} aria-hidden="true" focusable="false" fill=${ATTRIBUTES.fill} stroke=${ATTRIBUTES.stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"></path></svg>`;
}

export function renderCrossIcon(): TemplateResult {
  return html`<svg class="ui-icon" viewBox=${ATTRIBUTES.viewBox} aria-hidden="true" focusable="false" fill=${ATTRIBUTES.fill} stroke=${ATTRIBUTES.stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6 18 18"></path><path d="M18 6 6 18"></path></svg>`;
}

export function renderResendIcon(): TemplateResult {
  return html`<svg class="ui-icon" viewBox=${ATTRIBUTES.viewBox} aria-hidden="true" focusable="false" fill=${ATTRIBUTES.fill} stroke=${ATTRIBUTES.stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path></svg>`;
}

export function renderRecallIcon(): TemplateResult {
  return html`<svg class="ui-icon" viewBox=${ATTRIBUTES.viewBox} aria-hidden="true" focusable="false" fill=${ATTRIBUTES.fill} stroke=${ATTRIBUTES.stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"></path><path d="M4 9h10a6 6 0 0 1 0 12h-3"></path></svg>`;
}

export function renderRunIcon(): TemplateResult {
  return html`<svg class="ui-icon" viewBox=${ATTRIBUTES.viewBox} aria-hidden="true" focusable="false" fill=${ATTRIBUTES.fill} stroke=${ATTRIBUTES.stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 5 11 7-11 7z"></path></svg>`;
}

export function renderUpIcon(): TemplateResult {
  return html`<svg class="ui-icon" viewBox=${ATTRIBUTES.viewBox} aria-hidden="true" focusable="false" fill=${ATTRIBUTES.fill} stroke=${ATTRIBUTES.stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"></path><path d="m6 11 6-6 6 6"></path></svg>`;
}

export function renderDownIcon(): TemplateResult {
  return html`<svg class="ui-icon" viewBox=${ATTRIBUTES.viewBox} aria-hidden="true" focusable="false" fill=${ATTRIBUTES.fill} stroke=${ATTRIBUTES.stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="m6 13 6 6 6-6"></path></svg>`;
}

export function renderDoubleCheckIcon(): TemplateResult {
  return html`<svg class="ui-icon" viewBox=${ATTRIBUTES.viewBox} aria-hidden="true" focusable="false" fill=${ATTRIBUTES.fill} stroke=${ATTRIBUTES.stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 12 4 4 7-8"></path><path d="m11 16 2 2 8-10"></path></svg>`;
}

export function renderPendingRingIcon(): TemplateResult {
  return html`<svg class="ui-icon" viewBox=${ATTRIBUTES.viewBox} aria-hidden="true" focusable="false" fill=${ATTRIBUTES.fill} stroke=${ATTRIBUTES.stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle></svg>`;
}

export function renderFilledDotIcon(): TemplateResult {
  return html`<svg class="ui-icon" viewBox=${ATTRIBUTES.viewBox} aria-hidden="true" focusable="false" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="6"></circle></svg>`;
}

export const uiIconStyle = `
  .ui-icon { flex: 0 0 auto; width: 14px; height: 14px; vertical-align: -0.15em; pointer-events: none; }
`;
