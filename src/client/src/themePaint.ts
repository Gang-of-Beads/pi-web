/**
 * The look last painted, kept so index.html can paint it again before any module or plugin loads.
 *
 * Owner report (#76): a returning reader saw the default theme for a moment, then their own once
 * the bundle and the theme's plugin had loaded. The inline script in index.html reads this key and
 * applies the stored properties in the first frame; when the saved preference follows the system (or
 * none is saved) and the stored colour scheme differs from the system's, it leaves the stylesheet's
 * own light/dark defaults alone.
 */
export const PAINTED_THEME_STORAGE_KEY = "pi-web-painted-theme";

export interface PaintedTheme {
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
