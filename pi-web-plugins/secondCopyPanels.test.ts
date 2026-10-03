// @vitest-environment happy-dom
import { html, render, svg, type TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWebPlugin, PluginLifecycleEvent, WorkspacePanelContext, WorkspacePanelContribution } from "@gang-of-beads/pi-web/plugin-api";
import { stubWorkspaceFiles } from "../src/client/src/plugins/workspaceFilesTestSupport.js";
import { noPanelTerminal } from "./terminalSessionsTestSupport.js";

/**
 * A second copy of a plugin on one page (another machine's, B51) renders its panel through the
 * element class the first copy defined (B53). The files, relays and tasks panels reached their
 * panel through module functions reading a static on their own module's class, which the second
 * copy never sets: its Refresh, Upload and stale mark did nothing, and its badge read a cache the
 * panel never wrote. Each case activates a first copy, then a second one after a module reset, and
 * drives the second copy's own controls against the panel its own registration rendered.
 */
type Listener = (event: PluginLifecycleEvent) => void;

interface Copy {
  panel: WorkspacePanelContribution;
  emit: (event: PluginLifecycleEvent) => void;
}

function isPlugin(value: unknown): value is PiWebPlugin {
  return typeof value === "object" && value !== null && "activate" in value && typeof value.activate === "function";
}

async function activateCopy(entry: string, panelId: string): Promise<Copy> {
  const module: unknown = await import(entry);
  const plugin: unknown = typeof module === "object" && module !== null ? Reflect.get(module, "default") : undefined;
  if (!isPlugin(plugin)) throw new Error(`${entry} has no plugin`);
  const listeners: Listener[] = [];
  const activation = plugin.activate({
    apiVersion: 2,
    pluginId: panelId,
    runtimePluginId: panelId,
    html,
    svg,
    on: (_kind, listener) => { listeners.push((event) => { Reflect.apply(listener, undefined, [event]); }); return () => undefined; },
  });
  const panel = activation.contributions.workspacePanels?.find((candidate) => candidate.id === panelId);
  if (panel === undefined) throw new Error(`${entry} has no ${panelId} panel`);
  return { panel, emit: (event) => { for (const listener of listeners) listener(event); } };
}

async function secondCopy(entry: string, panelId: string): Promise<Copy> {
  await activateCopy(entry, panelId);
  vi.resetModules();
  return activateCopy(`${entry}?second-machine`, panelId);
}

function panelContext(machineId: string): WorkspacePanelContext {
  return {
    machine: { id: machineId, name: machineId, kind: "remote" },
    workspace: { id: "ws-1", projectId: "project-1", path: "/repo", label: "repo", isMain: true },
    files: stubWorkspaceFiles(),
    host: { requestRender: () => undefined, workspacePanelFullscreen: () => false, setWorkspacePanelFullscreen: () => undefined },
    prompt: { insertText: () => undefined, getText: () => "", getSelection: () => null },
    terminal: noPanelTerminal(),
  };
}

function mount(template: TemplateResult): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  render(template, host);
  const element = host.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error("the panel rendered no element");
  return element;
}

function clickToolbar(copy: Copy, context: WorkspacePanelContext, label: string): void {
  const toolbar = copy.panel.toolbar;
  if (toolbar === undefined) throw new Error("no toolbar");
  const bar = document.createElement("div");
  document.body.append(bar);
  render(toolbar(context), bar);
  const button = [...bar.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === label);
  if (button === undefined) throw new Error(`no ${label} button`);
  button.click();
}

/** What the end of a copy's toolbar says, as the host draws it at the top of the page. */
function toolbarStatus(copy: Copy, context: WorkspacePanelContext): string | undefined {
  const toolbar = copy.panel.toolbar;
  if (toolbar === undefined) throw new Error("no toolbar");
  const bar = document.createElement("div");
  render(toolbar(context), bar);
  return bar.querySelector(".files-toolbar-status")?.textContent.trim();
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

function countCalls(element: HTMLElement, method: string): () => number {
  const original: unknown = Reflect.get(element, method);
  if (typeof original !== "function") throw new Error(`the panel has no ${method}`);
  let calls = 0;
  Reflect.set(element, method, (...args: unknown[]): unknown => {
    calls += 1;
    const result: unknown = Reflect.apply(original, element, args);
    return result;
  });
  return () => calls;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("a second copy's controls reach the panel its own registration rendered (B53)", () => {
  it("files: Refresh and Upload reach the panel, and its out of date mark clears once that refresh lands", async () => {
    const copy = await secondCopy("./files/pi-web-plugin.ts", "files");
    const listing = (path: string) => Promise.resolve({ path, entries: [], scannedAt: "2026-10-03T00:00:00.000Z", truncated: false });
    const context = { ...panelContext("remote-b"), files: stubWorkspaceFiles({ listFiles: listing }) };
    const panel = mount(copy.panel.render(context));
    await settle();
    const refreshed = countCalls(panel, "refresh");
    const uploads = countCalls(panel, "openFilePicker");

    copy.emit({ kind: "session-activity-settled", sessionId: "s1", machineId: "remote-b" });
    const staleAfterTurn = toolbarStatus(copy, context);
    clickToolbar(copy, context, "Upload");
    await copy.panel.onInvalidate?.(context);
    await vi.waitFor(() => { if (toolbarStatus(copy, context) !== undefined) throw new Error("the refresh has not landed"); });

    expect({ staleAfterTurn, refreshed: refreshed(), uploads: uploads(), staleAfterRefresh: toolbarStatus(copy, context) })
      .toEqual({ staleAfterTurn: "out of date", refreshed: 1, uploads: 1, staleAfterRefresh: undefined });
  });

  it("relays: Refresh reaches the panel", async () => {
    const copy = await secondCopy("./relays/pi-web-plugin.ts", "workspace.relays");
    const context = panelContext("remote-b");
    const panel = mount(copy.panel.render(context));
    await settle();
    const refreshed = countCalls(panel, "refresh");

    clickToolbar(copy, context, "Refresh");

    expect(refreshed()).toBe(1);
  });

  it("tasks: Refresh reaches the panel, and the badge reads what the panel loaded", async () => {
    const copy = await secondCopy("./workspace-tasks/pi-web-plugin.ts", "workspace.tasks");
    const context = panelContext("remote-b");
    const panel = mount(copy.panel.render(context));
    await settle();
    const refreshed = countCalls(panel, "refreshConfig");

    clickToolbar(copy, context, "Refresh");
    await settle();

    expect({ refreshed: refreshed(), badge: copy.panel.badge?.(context) }).toEqual({ refreshed: 1, badge: "!" });
  });
});
