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
  button { box-sizing: border-box; min-height: var(--pi-control-height); padding-block: var(--pi-space-2); }
  /* Inputs and selects pin their height (a select's UA padding out-grew the
     input beside it); buttons keep min-height - the Appearance theme cards
     are buttons with ~180px of content that a hard clamp crushed. */
  input:not([type="checkbox"]):not([type="radio"]), select { box-sizing: border-box; height: var(--pi-control-height); }
  textarea { min-height: calc(var(--pi-control-height) * 2); }
  input[type="checkbox"], input[type="radio"] { box-sizing: border-box; width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); accent-color: var(--pi-accent); }
  @media (pointer: coarse) {
    button, input:not([type="checkbox"]):not([type="radio"]), select { min-height: var(--pi-control-height-touch); }
    input:not([type="checkbox"]):not([type="radio"]), select { height: var(--pi-control-height-touch); }
  }
`;
