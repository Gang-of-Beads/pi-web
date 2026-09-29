import { afterEach, describe, expect, it, vi } from "vitest";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("opening a workspace tool", () => {
  it("opens the folded side panel on a desktop, where the tool is shown", () => {
    const app = createApp({ phone: false, workspacePanelCollapsed: true });

    openWorkspaceTool(app, "background-runs:workspace.background");

    expect({ collapsed: workspacePanelCollapsed(app), tool: stateOf(app).workspaceTool }).toEqual({ collapsed: false, tool: "background-runs:workspace.background" });
  });

  it("leaves the phone's fold alone: the tool takes the whole view there", () => {
    const app = createApp({ phone: true, workspacePanelCollapsed: true });

    openWorkspaceTool(app, "files:files");

    expect({ collapsed: workspacePanelCollapsed(app), view: stateOf(app).mainView }).toEqual({ collapsed: true, view: "files:files" });
  });
});

function createApp(options: { phone: boolean; workspacePanelCollapsed: boolean }): PiWebApp {
  const stored = JSON.stringify(options.workspacePanelCollapsed ? { workspacePanelCollapsed: true } : {});
  const matchMedia = (query: string) => ({ matches: options.phone && query.includes("max-width"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined });
  vi.stubGlobal("window", {
    location: { search: "", pathname: "/", hash: "", href: "https://pi.example.test/" },
    localStorage: { getItem: (key: string) => (key === "pi-web-app-panel-collapse" ? stored : null), setItem: () => undefined, removeItem: () => undefined },
    matchMedia,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    history: { pushState: () => undefined, replaceState: () => undefined, state: null },
  });
  if (typeof document === "undefined") {
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/", visibilityState: "visible", hasFocus: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
  }
  return new PiWebApp();
}

function stateOf(app: PiWebApp): { workspaceTool?: unknown; mainView?: unknown } {
  const state: unknown = Reflect.get(app, "state");
  if (typeof state !== "object" || state === null) throw new Error("PiWebApp state was unavailable");
  return { workspaceTool: Reflect.get(state, "workspaceTool"), mainView: Reflect.get(state, "mainView") };
}

function openWorkspaceTool(app: PiWebApp, tool: string): void {
  const method: unknown = Reflect.get(app, "openWorkspaceTool");
  if (typeof method !== "function") throw new Error("PiWebApp.openWorkspaceTool is not callable");
  method.call(app, tool);
}

function workspacePanelCollapsed(app: PiWebApp): boolean {
  const collapse: unknown = Reflect.get(app, "panelCollapse");
  const value: unknown = typeof collapse === "object" && collapse !== null ? Reflect.get(collapse, "workspacePanelCollapsed") : undefined;
  if (typeof value !== "boolean") throw new Error("PiWebApp panelCollapse.workspacePanelCollapsed was unavailable");
  return value;
}
