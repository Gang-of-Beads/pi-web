import { css } from "lit";

/**
 * The title banner every phone surface shares.
 *
 * The drawer header, the context sheet header and the settings header each
 * grew their own padding and type size, so the same title read at three
 * heights depending on which surface was open. This is the one template:
 * a row pinned to the panel-header height tokens, one title size, one action
 * control height. Surfaces add only what makes them different (the sheet's
 * sticky bleed, the settings' eyebrow).
 */
export const panelHeaderStyles = css`
  .panel-header {
    box-sizing: border-box;
    min-height: var(--pi-panel-header-height);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pi-space-4);
    padding-inline: var(--pi-bar-inset);
    background: var(--pi-bg);
    border-bottom: 1px solid var(--pi-border);
  }
  .panel-header-title {
    /* A single-line label centred by the bar's flex needs an even line box:
     a 15px line in a 36px control rounds to 10/11 and the title reads 1px
     high. The line box is the control height, so centre is exact. */
    line-height: var(--pi-panel-header-control-height);
    font-size: var(--pi-text-sm);
    font-weight: var(--pi-weight-semibold);
    color: var(--pi-text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .panel-header-action {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--pi-panel-header-control-height);
    height: var(--pi-panel-header-control-height);
    flex: 0 0 auto;
    border: 1px solid var(--pi-border);
    background: var(--pi-surface);
    border-radius: var(--pi-radius-md);
    background: transparent;
    color: var(--pi-muted);
    cursor: pointer;
  }
  .panel-header-action svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .panel-header-action:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
  @media (pointer: coarse) { .panel-header-action:active { background: var(--pi-surface-hover); } }
`;
