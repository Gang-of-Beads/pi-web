/**
 * The core's own light palette.
 *
 * The native look already had a light side, but only behind
 * `prefers-color-scheme: light` in index.html: a phone in dark mode could
 * never reach it, and the appearance panel offered "Pro (native) - Dark"
 * alone. These are the same values, exposed as a theme the reader can pick,
 * with a guard test that fails if the two copies ever drift.
 */

import type { QualifiedContributionId, ThemeToken } from "./plugins/types";

export const CORE_PRO_LIGHT_THEME_ID: QualifiedContributionId = "core:pro-light";

export const CORE_PRO_LIGHT_TOKENS: Partial<Record<ThemeToken, string>> = {
  "--pi-bg": "#f6f5f2",
  "--pi-surface": "#ffffff",
  "--pi-surface-hover": "#eceae4",
  "--pi-terminal-bg": "#14161a",
  "--pi-terminal-text": "#e2e5ea",
  "--pi-border": "#c6c1b6",
  "--pi-border-muted": "#ddd9d0",
  "--pi-text": "#33373d",
  "--pi-text-secondary": "#5c626b",
  "--pi-text-bright": "#1b1e23",
  "--pi-muted": "#6f757e",
  "--pi-dim": "#8f959d",
  "--pi-accent": "#8a6510",
  "--pi-on-accent": "#ffffff",
  "--pi-accent-border": "#b07f1c",
  "--pi-selection-bg": "#f2e7cd",
  "--pi-success": "#1f7a33",
  "--pi-success-border": "#2f8f45",
  "--pi-success-bg": "#e9f4ea",
  "--pi-success-surface": "#ddefe0",
  "--pi-success-ring": "#1f7a3355",
  "--pi-warning": "#8a6d10",
  "--pi-warning-border": "#a3851a",
  "--pi-warning-surface": "#f7f0da",
  "--pi-danger": "#c93c31",
  "--pi-purple": "#6d4fc4",
  "--pi-purple-border": "#7d5ed6",
  "--pi-purple-surface": "#efeafb",
  "--pi-overlay": "#14161acc",
  "--pi-bg-overlay-soft": "#f6f5f2dd",
  "--pi-bg-overlay": "#f6f5f2e6",
  "--pi-success-bg-overlay": "#e9f4eaee",
  "--pi-terminal-selection": "#3a404b",
  "--pi-shadow-soft": "#0000",
  "--pi-shadow": "#0000",
  "--pi-shadow-strong": "#0000",
};
