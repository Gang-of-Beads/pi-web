/** What the address bar and the app each say is on screen. */
export interface RouteSurface {
  machine?: string | undefined;
  project?: string | undefined;
  workspace?: string | undefined;
  session?: string | undefined;
  view?: string | undefined;
}

export function routeMatchesUrl(url: RouteSurface, state: RouteSurface): boolean {
  return url.machine === state.machine
    && url.project === state.project
    && url.workspace === state.workspace
    && url.session === state.session
    && (url.view ?? "navigation") === (state.view ?? "navigation");
}
