/** What the address bar and the app each say is on screen. */
export interface RouteSurface {
  machine?: string | undefined;
  project?: string | undefined;
  workspace?: string | undefined;
  session?: string | undefined;
  view?: string | undefined;
}

/**
 * The view is only written to the URL when it differs from what the layout
 * would show anyway, so what an absent view means depends on the layout. The
 * caller knows which view that is; guessing it here made every desktop route
 * compare unequal.
 */
export function routeMatchesUrl(url: RouteSurface, state: RouteSurface, viewWhenAbsent: string): boolean {
  return url.machine === state.machine
    && url.project === state.project
    && url.workspace === state.workspace
    && url.session === state.session
    && (url.view ?? viewWhenAbsent) === (state.view ?? viewWhenAbsent);
}
