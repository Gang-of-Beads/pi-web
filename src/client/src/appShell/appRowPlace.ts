/**
 * Where the app row draws: under the header of the page in view (owner, 2026-10-09, on the row
 * sitting above the phone Navigate page's header). A dialog lifts the row above every surface
 * (owner, 2026-10-04); Navigate, as an overlay or as the phone's navigation view, has its own
 * header and takes the row under it; anywhere else it sits in the main column under the context
 * bar. One place at a time, so the row is never drawn twice or hidden behind a surface.
 */
export type AppRowPlace = "dialog-layer" | "navigate-overlay" | "navigation-view" | "main";

export interface AppRowPlaceFacts {
  readonly modalPresent: boolean;
  readonly navigateOpen: boolean;
  readonly phoneNavigationView: boolean;
}

export function appRowPlace(facts: AppRowPlaceFacts): AppRowPlace {
  if (facts.modalPresent) return "dialog-layer";
  if (facts.navigateOpen) return "navigate-overlay";
  if (facts.phoneNavigationView) return "navigation-view";
  return "main";
}
