/**
 * The favicon follows the active theme: the pi glyph in the theme's accent on
 * its background tile, swapped in as a data URL whenever a theme is applied -
 * including the core's own dark and light looks, which used to leave whatever
 * icon was there before. Desktop and home-screen icons are fixed at install
 * time by platform rules; the tab icon is the surface that can honestly
 * follow.
 *
 * The glyph is typeset in the product's mono stack rather than drawn as
 * pixels, so the icon and the interface are the same letterform. A theme may
 * bring its own icon instead; that markup is used verbatim.
 */

const MONO_STACK = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

export function themeFaviconSvg(accent: string, background: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
    `<rect width="1024" height="1024" rx="224" fill="${background}"/>`,
    `<text x="512" y="512" fill="${accent}" font-family="${MONO_STACK}" font-size="720" font-weight="600" text-anchor="middle" dominant-baseline="central">&#960;</text>`,
    "</svg>",
  ].join("");
}

export function themeFaviconHref(accent: string, background: string): string {
  return `data:image/svg+xml,${encodeURIComponent(themeFaviconSvg(accent, background))}`;
}

/** A theme-supplied icon: inline SVG markup or an image URL, used as it is. */
export function customFaviconHref(icon: string): string {
  const trimmed = icon.trim();
  if (trimmed.startsWith("<svg")) return `data:image/svg+xml,${encodeURIComponent(trimmed)}`;
  return trimmed;
}

export interface FaviconDocument {
  querySelector(selector: string): { setAttribute(name: string, value: string): void } | null;
}

export function applyThemeFavicon(tokens: Record<string, string>, doc: FaviconDocument, icon?: string): void {
  const link = doc.querySelector('link[rel="icon"]');
  if (link === null) return;
  if (icon !== undefined && icon.trim() !== "") {
    link.setAttribute("href", customFaviconHref(icon));
    return;
  }
  const accent = tokens["--pi-accent"];
  const background = tokens["--pi-bg"];
  if (accent === undefined || background === undefined) return;
  link.setAttribute("href", themeFaviconHref(accent, background));
}
