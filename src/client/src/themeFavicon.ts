/**
 * The favicon follows the active theme: a pixel pi glyph drawn in the theme's
 * accent on its background tile, swapped in as a data URL whenever the theme
 * is applied. Desktop and home-screen icons are fixed at install time by
 * platform rules; the tab icon is the surface that can honestly follow.
 */

const PIXEL = 128;
const GLYPH: readonly (readonly [number, number])[] = [
  [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2],
  [2, 3], [5, 3],
  [2, 4], [5, 4],
  [2, 5], [5, 5],
  [1, 6], [5, 6], [6, 6],
];

export function themeFaviconSvg(accent: string, background: string): string {
  const cells = GLYPH
    .map(([x, y]) => `<rect x="${String(x * PIXEL)}" y="${String(y * PIXEL)}" width="${String(PIXEL)}" height="${String(PIXEL)}" fill="${accent}"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="224" fill="${background}"/>${cells}</svg>`;
}

export function themeFaviconHref(accent: string, background: string): string {
  return `data:image/svg+xml,${encodeURIComponent(themeFaviconSvg(accent, background))}`;
}

export interface FaviconDocument {
  querySelector(selector: string): { setAttribute(name: string, value: string): void } | null;
}

export function applyThemeFavicon(tokens: Record<string, string>, doc: FaviconDocument): void {
  const accent = tokens["--pi-accent"];
  const background = tokens["--pi-bg"];
  if (accent === undefined || background === undefined) return;
  const link = doc.querySelector('link[rel="icon"]');
  if (link === null) return;
  link.setAttribute("href", themeFaviconHref(accent, background));
}
