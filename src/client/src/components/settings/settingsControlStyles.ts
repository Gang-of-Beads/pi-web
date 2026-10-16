import { css } from "lit";

/**
 * The control shapes every settings panel shares.
 *
 * Sixteen panel files grew their own form styles and none of them named a
 * control height or a coarse-pointer floor: one General screen shipped a 40px
 * input above a 42px select above a 35px primary button, and the save control a
 * finger has to hit measured 35px beside a 44px close. The dialog shell held
 * the scale while its contents did not, because there was nowhere shared to put
 * it. This is that place: adopt it beside the panel's own styles and a panel
 * only writes what makes it different.
 */
export const settingsControlStyles = css`
  button, input, select, textarea { box-sizing: border-box; font: inherit; }
  code { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-xs); background: var(--pi-bg); padding: var(--pi-space-1) var(--pi-space-2); color: var(--pi-text); font: var(--pi-text-xs) var(--pi-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); line-height: inherit; overflow-wrap: anywhere; }
  button { box-sizing: border-box; min-height: var(--pi-control-height); padding-block: var(--pi-space-2); }
  /* Inputs and selects pin their height (a select's UA padding out-grew the
     input beside it); buttons keep min-height - the Appearance theme cards
     are buttons with ~180px of content that a hard clamp crushed. */
  input:not([type="checkbox"]):not([type="radio"]), select { box-sizing: border-box; height: var(--pi-control-height); }
  textarea { min-height: calc(var(--pi-control-height) * 2); }
  input[type="checkbox"], input[type="radio"] { box-sizing: border-box; width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); accent-color: var(--pi-accent); }
  /* Words and keys that stand outside a card keep the cards' inner edge (their padding and border):
     an unframed heading flush with framed cards read as sticking out (owner, 2026-10-16). */
  :host { --pi-settings-inner-edge: calc(var(--pi-space-6) + 1px); }
  .unframed { padding-inline: var(--pi-settings-inner-edge); }
  /* A section is a card with its title, words and keys inside (owner, 2026-10-16). */
  .section-card { padding: var(--pi-space-6); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); }
  /* One section title everywhere, framed or not: the pages had grown four sizes for the same rank. */
  h3 { margin: 0; color: var(--pi-text-bright, var(--pi-text)); font-size: var(--pi-text-base); font-weight: var(--pi-weight-semibold); line-height: 1.3; }
  @media (pointer: coarse) {
    button, input:not([type="checkbox"]):not([type="radio"]), select { min-height: var(--pi-control-height-touch); }
    input:not([type="checkbox"]):not([type="radio"]), select { height: var(--pi-control-height-touch); }
  }
`;
