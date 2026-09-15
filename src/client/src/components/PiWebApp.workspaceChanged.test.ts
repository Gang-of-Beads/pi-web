import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { BrowserRealtimeEvent } from "../sessionSocket";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const workspace = { id: "w1", projectId: "p1", path: "/repo", label: "main", isMain: true, effectiveConfig: {} } as const;
const local = { id: "local", name: "local", kind: "local", createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z" } as const;

describe("PiWebApp workspace.changed wiring", () => {
  it("refreshes the shown workspace's panels for its own directory on the selected machine", () => {
    const app = createApp();
    const invalidated: unknown[] = [];
    observeInvalidate(app, invalidated);
    setAppState(app, { ...initialAppState(), selectedWorkspace: workspace, selectedMachine: local });

    handleRealtimeEvent(app, "local", { type: "workspace.changed", cwd: "/repo" });

    expect(invalidated).toHaveLength(1);
  });

  it("ignores a change for another directory, another machine, or when no workspace is shown", () => {
    const app = createApp();
    const invalidated: unknown[] = [];
    observeInvalidate(app, invalidated);
    setAppState(app, { ...initialAppState(), selectedWorkspace: workspace, selectedMachine: local });

    handleRealtimeEvent(app, "local", { type: "workspace.changed", cwd: "/elsewhere" });
    handleRealtimeEvent(app, "remote-a", { type: "workspace.changed", cwd: "/repo" });
    setAppState(app, { ...initialAppState(), selectedWorkspace: undefined, selectedMachine: local });
    handleRealtimeEvent(app, "local", { type: "workspace.changed", cwd: "/repo" });

    expect(invalidated).toEqual([]);
  });
});

function createApp(): PiWebApp {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vi.stubGlobal("window", {
    location: { search: "" },
    localStorage: storage,
    matchMedia: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
  });
  if (typeof document === "undefined") {
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/", visibilityState: "visible", hasFocus: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
  }
  vi.stubGlobal("requestAnimationFrame", () => 1);
  return new PiWebApp();
}

function setAppState(app: PiWebApp, state: AppState): void {
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp state");
}

function observeInvalidate(app: PiWebApp, sink: unknown[]): void {
  if (!Reflect.set(app, "invalidateWorkspacePanels", (panelId: unknown) => { sink.push(panelId); return Promise.resolve(); })) throw new Error("Could not observe invalidateWorkspacePanels");
}

type HandleRealtimeEvent = (machineId: string, event: BrowserRealtimeEvent) => void;

function isHandleRealtimeEvent(value: unknown): value is HandleRealtimeEvent {
  return typeof value === "function";
}

function handleRealtimeEvent(app: PiWebApp, machineId: string, event: BrowserRealtimeEvent): void {
  const method: unknown = Reflect.get(app, "handleRealtimeEvent");
  if (!isHandleRealtimeEvent(method)) throw new Error("PiWebApp.handleRealtimeEvent is not callable");
  method.call(app, machineId, event);
}
