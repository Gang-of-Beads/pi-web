import type { TemplateResult } from "lit";

/**
 * One workspace tool card in the shell: the single entry a contributed panel
 * gets in the tool list. This outlived the navigation accordion it was
 * declared in, so it lives on its own rather than inside a deleted surface.
 */
export interface ShellToolTab {
  id: string;
  label: string;
  /** The contributing panel's icon; the card renders it before the label. */
  icon?: TemplateResult | undefined;
  /** Text-safe badge only: the row renders it inline, no rich template. */
  badge?: string | number;
  badgeLabel?: string | undefined;
  selected?: boolean;
}
