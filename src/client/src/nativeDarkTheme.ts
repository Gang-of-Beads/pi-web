/**
 * The core's own dark palette, for when it is picked rather than inherited.
 *
 * The dark values live in the stylesheet's base `:root`, which the light
 * `prefers-color-scheme` block overrides: choosing "Pro (native)" on a device
 * whose system prefers light therefore stayed light. Picking a look must win
 * over the system, so the picked dark side sets the same values the base block
 * declares, and a guard keeps the two copies equal.
 */

import type { ThemeToken } from "./plugins/types";

export const CORE_PRO_DARK_TOKENS: Partial<Record<ThemeToken, string>> = {
  "--pi-bg": "#131519",
  "--pi-surface": "#1a1d23",
  "--pi-surface-hover": "#23272f",
  "--pi-terminal-bg": "#0e1013",
  "--pi-terminal-text": "#dfe3ea",
  "--pi-border": "#383e48",
  "--pi-border-muted": "#262b33",
  "--pi-text": "#d5dae2",
  "--pi-text-secondary": "#a7aeb9",
  "--pi-text-bright": "#eef1f5",
  "--pi-muted": "#8b929d",
  "--pi-dim": "#6b7280",
  "--pi-accent": "#d9a24a",
  "--pi-on-accent": "#201a0c",
  "--pi-accent-border": "#8a6a2a",
  "--pi-selection-bg": "#332c1a",
  "--pi-success": "#56b463",
  "--pi-success-border": "#2f6e3c",
  "--pi-success-bg": "#12211a",
  "--pi-success-surface": "#142a1d",
  "--pi-success-ring": "#56b46355",
  "--pi-warning": "#d7b256",
  "--pi-warning-border": "#6e5a1a",
  "--pi-warning-surface": "#242110",
  "--pi-danger": "#e5695f",
  "--pi-purple": "#c7a5f5",
  "--pi-purple-border": "#9a6ff0",
  "--pi-purple-surface": "#221636",
  "--pi-overlay": "#000c",
  "--pi-shadow-soft": "#0000",
  "--pi-shadow": "#0000",
  "--pi-shadow-strong": "#0000",
  "--pi-bg-overlay-soft": "#131519dd",
  "--pi-bg-overlay": "#131519e6",
  "--pi-success-bg-overlay": "#12211aee",
  "--pi-terminal-selection": "#4a3d1e",
};
