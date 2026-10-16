/**
 * The look last painted, kept so index.html can paint it again before any module or plugin loads.
 *
 * Owner report (#76): a returning reader saw the default theme for a moment, then their own once
 * the bundle and the theme's plugin had loaded. The inline script in index.html reads this key and
 * applies the stored properties in the first frame. It paints only a look that answers the saved
 * preference, spelled as it is stored, and, when the look was chosen by the system's light/dark
 * scheme, only while the system still prefers that scheme; otherwise it leaves the stylesheet's own
 * light/dark defaults alone. Both facts are recorded by the code that chose the look (review of
 * 2e61a200: re-deriving them from the preference in the script missed an unpaired theme with "follow
 * the system" on, which stays selected whatever the system prefers, and a tab whose preference in
 * memory differed from the stored one painted a theme the reader had not chosen).
 */
export const PAINTED_THEME_STORAGE_KEY = "pi-web-painted-theme";

/** What a painted look answers: the stored preference, and whether the system's scheme picked it. */
export interface PaintScope {
  preference: string;
  followsSystem: boolean;
}

export interface PaintedTheme extends PaintScope {
  colorScheme: "light" | "dark";
  properties: Record<string, string>;
}

export function rememberPaintedTheme(painted: PaintedTheme): void {
  try {
    window.localStorage.setItem(PAINTED_THEME_STORAGE_KEY, JSON.stringify(painted));
  } catch {
    return;
  }
}
