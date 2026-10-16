/**
 * The favicon follows the active theme: the app's pi mark in the theme's
 * accent on its background tile, swapped in as a data URL whenever a theme is
 * applied - including the core's own dark and light looks. Desktop and
 * home-screen icons are fixed at install time by platform rules, so the
 * shipped icons are this same mark in the default Material Dark colours; the
 * tab icon is the surface that can honestly follow.
 *
 * The mark is drawn as paths, the same shape as public/favicon.svg and the
 * launcher PNGs, so no font has to exist where it renders. A theme may bring
 * its own icon instead; that markup is used verbatim.
 */

const PI_MARK_PATHS = '<path d="M 262 348 Q 306 320 380 320 L 762 320"/><path d="M 404 320 L 404 704"/><path d="M 636 320 L 636 620 Q 636 704 724 704"/>';

export function themeFaviconSvg(accent: string, background: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
    `<rect width="1024" height="1024" rx="224" fill="${background}"/>`,
    `<g fill="none" stroke="${accent}" stroke-width="94" stroke-linecap="round">${PI_MARK_PATHS}</g>`,
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
