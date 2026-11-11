// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRowPlace } from "../appShell/appRowPlace";
import { initialAppState, type AppState } from "../appState";
import { PiWebApp } from "./PiWebApp";

/**
 * Android back = history.back() = popstate. The app must answer the gesture
 * one layer at a time: a modal layer that is open closes first, a leftover
 * placeholder frame from a closed layer does nothing, and only a real route
 * change (URL differs from the current state) restores the previous session.
 */
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp back gesture", () => {
  it("closes the quick switcher instead of restoring the route while it is open", () => {
    const app = createApp();
    setAppState(app, stateWithSession());
    Reflect.set(app, "quickSwitcherOpen", true);
    const restoreRoute = stubRestoreRoute(app);

    popState(app);

    expect(Reflect.get(app, "quickSwitcherOpen")).toBe(false);
    expect(restoreRoute).not.toHaveBeenCalled();
  });

  it("closes the navigation page, which is the outermost layer", () => {
    const app = createApp();
    setAppState(app, stateWithSession());
    Reflect.set(app, "navigateOpen", true);
    const restoreRoute = stubRestoreRoute(app);

    popState(app);

    expect(Reflect.get(app, "navigateOpen")).toBe(false);
    expect(restoreRoute).not.toHaveBeenCalled();
  });

  it("answers a dialog opened over the navigation page before the page itself", async () => {
    const app = createApp();
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
    setAppState(app, { ...initialAppState(), themeDialog: { title: "Theme", options: [] } });
    document.body.append(app);
    await app.updateComplete;
    Reflect.set(app, "navigateOpen", true);
    await app.updateComplete;

    expect(appRowPlaceOf(app)).toBe("dialog-layer");

    popState(app);

    expect(Reflect.get(app, "navigateOpen")).toBe(true);
    await app.updateComplete;
    expect(appRowPlaceOf(app)).toBe("navigate-overlay");

    popState(app);

    expect(Reflect.get(app, "navigateOpen")).toBe(false);
    await app.updateComplete;
    expect(appRowPlaceOf(app)).toBe("main");
    app.remove();
  });

  it("ignores a placeholder frame left by a layer closed through its own cancel", () => {
    const app = createApp();
    setAppState(app, stateWithSession());
    setUrl("?project=project-1&workspace=workspace-1&session=session-1&view=chat");
    const restoreRoute = stubRestoreRoute(app);

    popState(app);

    // URL still matches the current state, so the popped frame was ours.
    expect(restoreRoute).not.toHaveBeenCalled();
  });

  it("restores the previous route when the URL really changed", () => {
    const app = createApp();
    setAppState(app, stateWithSession());
    setUrl("?session=some-other-session");
    const restoreRoute = stubRestoreRoute(app);

    popState(app);

    expect(restoreRoute).toHaveBeenCalledOnce();
  });
});

function stubRestoreRoute(app: PiWebApp): ReturnType<typeof vi.fn> {
  const restoreRoute = vi.fn<() => Promise<void>>();
  if (!Reflect.set(app, "restoreRoute", restoreRoute)) throw new Error("Could not stub restoreRoute");
  return restoreRoute;
}

function popState(app: PiWebApp): void {
  const handler: unknown = Reflect.get(app, "onPopState");
  if (!isPopStateHandler(handler)) throw new Error("PiWebApp popstate handler was unavailable");
  handler();
}

type PopStateHandler = () => void;
type AppRowPlaceReader = (this: PiWebApp) => AppRowPlace;

function isPopStateHandler(value: unknown): value is PopStateHandler {
  return typeof value === "function";
}

function isAppRowPlaceReader(value: unknown): value is AppRowPlaceReader {
  return typeof value === "function";
}

function appRowPlaceOf(app: PiWebApp): AppRowPlace {
  const place: unknown = Reflect.get(app, "appRowPlace");
  if (!isAppRowPlaceReader(place)) throw new Error("appRowPlace was unavailable");
  return place.call(app);
}

function createApp(): PiWebApp {
  const storage: Storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  };
  vi.stubGlobal("localStorage", storage);
  return new PiWebApp();
}

function setUrl(search: string): void {
  const url = new URL(window.location.href);
  url.search = search;
  Object.defineProperty(window, "location", {
    value: { href: url.href, search: url.search },
    configurable: true,
    writable: true,
  });
}

function stateWithSession(): AppState {
  return {
    ...initialAppState(),
    selectedMachine: { id: "local", name: "local", kind: "local", createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z", status: "online" },
    selectedProject: { id: "project-1", name: "project-1", path: "/repo", createdAt: "2026-07-14T00:00:00.000Z" },
    selectedWorkspace: { id: "workspace-1", projectId: "project-1", label: "workspace-1", path: "/repo", isMain: true, effectiveConfig: {} },
    selectedSession: {
      id: "session-1",
      cwd: "/repo",
      path: "/repo/session-1.jsonl",
      created: "2026-07-14T00:00:00.000Z",
      modified: "2026-07-14T00:00:00.000Z",
      messageCount: 1,
      firstMessage: "hello",
    },
  };
}

function setAppState(app: PiWebApp, state: AppState): void {
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp state");
}