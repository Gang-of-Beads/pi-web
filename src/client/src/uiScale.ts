/**
 * How large the interface is drawn, chosen by the reader.
 *
 * A browser already has zoom, but a PI WEB installed as a PWA or opened on a
 * tablet has no zoom control to reach for, and browser zoom is remembered per
 * origin by the browser rather than by the app. The size someone can actually
 * read is a property of the screen they are looking at, so this is kept per
 * device in local storage, next to the theme preference, and never sent to the
 * machine config - a phone must not be able to shrink a desktop.
 *
 * Applied as `zoom` on the document element rather than by rewriting the scale
 * tokens: `zoom` scales everything, including the terminal and anything a
 * plugin draws, and it cannot leave one sheet out of step with another.
 *
 * It deliberately does not move the layout breakpoints. Those are CSS pixels
 * and stay CSS pixels under `zoom` (measured: at a 1000px viewport,
 * `zoom: 1.5` leaves `matchMedia("(max-width: 900px)")` false and renders a
 * 100px box 150px wide). So this makes the interface bigger; it does not turn
 * a desktop into a phone. Resizing the window is still what changes layout.
 */
export const UI_SCALE_STORAGE_KEY = "pi-web-app-scale";
export const DEFAULT_UI_SCALE = 1;
export const MIN_UI_SCALE = 0.8;
export const MAX_UI_SCALE = 1.5;
/** Five per cent: small enough to tune, large enough that a step is visible. */
export const UI_SCALE_STEP = 0.05;

/**
 * Bring any number into range and onto the step, so a hand-edited storage
 * value or a stale bookmark cannot render the app unusably small or large.
 */
export function clampUiScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_UI_SCALE;
  const stepped = Math.round(value / UI_SCALE_STEP) * UI_SCALE_STEP;
  const bounded = Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, stepped));
  // Round to two places: 0.1 * 3 is 0.30000000000000004, and that reaches the
  // DOM as a zoom value and the label as "30.000000000000004%".
  return Math.round(bounded * 100) / 100;
}

/** How the slider's value reads to someone who has to say it out loud. */
export function uiScaleLabel(scale: number): string {
  return `${String(Math.round(scale * 100))}%`;
}

export function readStoredUiScale(): number | undefined {
  try {
    const value = window.localStorage.getItem(UI_SCALE_STORAGE_KEY);
    if (value === null) return undefined;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? clampUiScale(parsed) : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredUiScale(scale: number): void {
  try {
    window.localStorage.setItem(UI_SCALE_STORAGE_KEY, String(clampUiScale(scale)));
  } catch {
    // Ignore storage failures; the chosen size still applies to this tab.
  }
}

export function applyUiScale(scale: number, root: HTMLElement = document.documentElement): void {
  const clamped = clampUiScale(scale);
  // The default is expressed as "no zoom at all" rather than "zoom: 1", so a
  // browser without `zoom` support behaves exactly as it did before the
  // setting existed instead of carrying an inert property.
  if (clamped === DEFAULT_UI_SCALE) root.style.removeProperty("zoom");
  else root.style.setProperty("zoom", String(clamped));
}
