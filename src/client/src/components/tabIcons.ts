import { svg, type TemplateResult } from "lit";

export function renderBuiltinTabIcon(): TemplateResult {
  return svg`
    <svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"></path>
    </svg>
  `;
}
