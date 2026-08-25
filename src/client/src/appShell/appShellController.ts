import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { AppState } from "../appState";
import { createPwaDisplayModeMedia, detectPwaDisplayMode } from "../pwaDisplayMode";
import { ViewportPositionRepairer } from "./viewportPositionRepair";

export const MOBILE_NAVIGATION_MEDIA_QUERY = "(max-width: 760px)";

export interface AppShellControllerOptions {
  mobileNavigationMedia?: MediaQueryList | undefined;
  pwaDisplayModeMedia?: MediaQueryList[] | undefined;
  viewportPositionRepairer?: ViewportPositionRepairer | undefined;
}

export class AppShellController implements ReactiveController {
  private readonly mobileNavigationMedia: MediaQueryList | undefined;
  private readonly pwaDisplayModeMedia: MediaQueryList[];
  private readonly viewportPositionRepairer: ViewportPositionRepairer;
  isMobileNavigationLayout: boolean;
  isPwaDisplayMode: boolean;

  constructor(private readonly host: ReactiveControllerHost, options: AppShellControllerOptions = {}) {
    host.addController(this);
    this.mobileNavigationMedia = options.mobileNavigationMedia ?? createMobileNavigationMedia();
    this.pwaDisplayModeMedia = options.pwaDisplayModeMedia ?? createPwaDisplayModeMedia();
    this.viewportPositionRepairer = options.viewportPositionRepairer ?? new ViewportPositionRepairer();
    this.isMobileNavigationLayout = this.mobileNavigationMedia?.matches ?? false;
    this.isPwaDisplayMode = detectPwaDisplayMode(this.pwaDisplayModeMedia);
  }

  hostConnected(): void {
    this.mobileNavigationMedia?.addEventListener("change", this.onMobileNavigationMediaChange);
    for (const media of this.pwaDisplayModeMedia) media.addEventListener("change", this.onPwaDisplayModeChange);
  }

  hostDisconnected(): void {
    this.mobileNavigationMedia?.removeEventListener("change", this.onMobileNavigationMediaChange);
    for (const media of this.pwaDisplayModeMedia) media.removeEventListener("change", this.onPwaDisplayModeChange);
    this.viewportPositionRepairer.clear();
  }

  shouldAutoFocusPrompt(): boolean {
    return !this.isMobileNavigationLayout && !this.isPwaDisplayMode;
  }

  shouldShowAppRefreshInHeader(): boolean {
    return this.isPwaDisplayMode && !this.isMobileNavigationLayout;
  }

  shouldShowAppRefreshInContextBar(): boolean {
    return this.isPwaDisplayMode && this.isMobileNavigationLayout;
  }

  defaultRouteView(route: { readonly sessionId?: string | undefined } = {}): AppState["mainView"] {
    return defaultRouteView(this.isMobileNavigationLayout, route);
  }

  repairViewportPosition(): void {
    this.viewportPositionRepairer.repair(this.shouldRepairViewportPosition());
  }

  private shouldRepairViewportPosition(): boolean {
    return this.isMobileNavigationLayout || this.isPwaDisplayMode;
  }

  private readonly onMobileNavigationMediaChange = (event: MediaQueryListEvent) => {
    if (this.isMobileNavigationLayout === event.matches) return;
    this.isMobileNavigationLayout = event.matches;
    this.host.requestUpdate();
  };

  private readonly onPwaDisplayModeChange = () => {
    const isPwaDisplayMode = detectPwaDisplayMode(this.pwaDisplayModeMedia);
    if (this.isPwaDisplayMode === isPwaDisplayMode) return;
    this.isPwaDisplayMode = isPwaDisplayMode;
    this.host.requestUpdate();
  };
}

function createMobileNavigationMedia(): MediaQueryList | undefined {
  if (typeof window === "undefined" || !("matchMedia" in window)) return undefined;
  return window.matchMedia(MOBILE_NAVIGATION_MEDIA_QUERY);
}

/**
 * Where a route with no explicit view should land.
 *
 * A narrow layout opens on navigation, because there is no room to show the
 * list and the chat at once - but a link that names a session has already made
 * that choice. Ignoring it meant a shared deep link put the reader in the
 * session list with the session they asked for hidden behind one more tap,
 * while the same link on a desktop opened the conversation directly.
 */
export function defaultRouteView(isMobileNavigationLayout: boolean, route: { readonly sessionId?: string | undefined }): AppState["mainView"] {
  if (!isMobileNavigationLayout) return "chat";
  const sessionId = route.sessionId ?? "";
  return sessionId === "" ? "navigation" : "chat";
}
