import { css, unsafeCSS } from "lit";
import { COARSE_OR_MOBILE_MEDIA_QUERY } from "../../breakpoints";

/**
 * The title banner every phone surface shares.
 *
 * The drawer header, the context sheet header and the settings header each
 * grew their own padding and type size, so the same title read at three
 * heights depending on which surface was open. This is the one template:
 * a row pinned to the panel-header height tokens and one title size; its keys
 * are barKeyStyles below. Surfaces add only what makes them different (the sheet's
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
`;

/**
 * The square key of every bar and sheet header (owner, 2026-10-14: the same key looked different
 * from surface to surface - a 16px menu glyph beside an 18px grid, close keys drawn muted and
 * see-through, keys a finger could not reach). One look everywhere: a 36px box with the bar's border
 * and surface, an 18px glyph in the text colour with a 2px stroke, and on a coarse pointer a 44px
 * reach without growing the drawn box. The reach is laid from inside the 1px border, so it reaches
 * one pixel further on each side (QA, 2026-10-14: it measured 42). Surfaces add only state.
 */
export const barKeyStyles = css`
  .bar-key { position: relative; box-sizing: border-box; flex: 0 0 auto; display: inline-grid; place-items: center; width: var(--pi-panel-header-control-height); height: var(--pi-panel-header-control-height); min-width: var(--pi-panel-header-control-height); min-height: var(--pi-panel-header-control-height); padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: inherit; line-height: 1; cursor: pointer; }
  .bar-key svg { width: 18px; height: 18px; stroke-width: 2; pointer-events: none; }
  .key-space { flex: 0 0 auto; width: var(--pi-panel-header-control-height); }
  .bar-key:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
  @media (hover: hover) { .bar-key:not(:disabled):hover { background: var(--pi-surface-hover); } }
  @media (pointer: coarse) {
    .bar-key::after { content: ""; position: absolute; inset: calc((var(--pi-panel-header-control-height) - var(--pi-control-height-touch)) / 2 - 1px); }
    .bar-key:not(:disabled):active { background: var(--pi-surface-hover); }
  }
`;

/**
 * A sheet that drops from the bar (Go to, New session). Its header carries a key where the bar's
 * key was, so a second press there closes what the first opened; without it the gesture had
 * nowhere to land. On the phone layout the sheet lies over the bar edge to edge, with no frame and
 * below the same safe areas the shell keeps, so that key sits on the exact box of the bar's key at
 * any width. Each sheet sets only its own height.
 */
export const barSheetStyles = css`
  modal-surface { --modal-surface-place-items: start center; --modal-surface-backdrop-padding: 0; --modal-surface-width: min(560px, 100vw); }
  @media ${unsafeCSS(COARSE_OR_MOBILE_MEDIA_QUERY)} {
    modal-surface { --modal-surface-border: 0; --modal-surface-radius: 0; --modal-surface-width: 100%; --modal-surface-backdrop-padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left); }
  }
  .panel-header { box-sizing: border-box; min-height: var(--pi-panel-header-height); display: flex; align-items: center; padding: 0 var(--pi-bar-inset); border-bottom: 1px solid var(--pi-border); }
  .panel-header-title { margin: 0; font-size: var(--pi-text-sm); font-weight: var(--pi-weight-semibold); color: var(--pi-text); line-height: var(--pi-panel-header-control-height); }
  .panel-key { margin-left: auto; }
`;
