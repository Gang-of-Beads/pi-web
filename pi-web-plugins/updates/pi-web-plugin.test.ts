import { html, svg } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { PluginRuntimeContext } from "@gang-of-beads/pi-web/plugin-api";
import { createPluginHostUi } from "../../src/client/src/plugins/pluginHostUi.js";
import plugin from "./pi-web-plugin.js";

describe("Updates plugin offer", () => {
  it("asks the host for the PI WEB status it already reads, and reads it itself only on an older host", async () => {
    const shared = vi.fn(() => Promise.resolve({ version: "1.0.0", release: { updateAvailable: false } }));
    const fetched: string[] = [];
    const fetchJson = (path: string) => { fetched.push(path); return Promise.resolve({ version: "1.0.0", release: { updateAvailable: false } }); };
    const callOperation = () => Promise.resolve({ answeredVersions: [] });
    const ui = createPluginHostUi();
    plugin.activate({ apiVersion: 2, pluginId: "updates", runtimePluginId: "updates", html, svg, fetchJson, callOperation, ui, readPiWebStatus: shared });
    await Promise.resolve();
    const withHostFact = { shared: shared.mock.calls.length, fetched: [...fetched] };
    plugin.activate({ apiVersion: 2, pluginId: "updates", runtimePluginId: "updates", html, svg, fetchJson, callOperation, ui });
    await Promise.resolve();

    expect({ withHostFact, olderHost: fetched }).toEqual({ withHostFact: { shared: 1, fetched: [] }, olderHost: ["api/pi-web/status"] });
  });
});

describe("Updates plugin actions", () => {
  it("forces an update check through the host runtime context", async () => {
    const action = plugin.activate({ apiVersion: 2, pluginId: "updates", runtimePluginId: "updates", html, svg }).contributions.actions?.find((candidate) => candidate.id === "check");
    if (action === undefined) throw new Error("Expected update check action");
    const checkForPiWebUpdates = vi.fn(() => Promise.resolve());
    const context = runtimeContext({ checkForPiWebUpdates });

    expect(action.enabled?.(context)).toBe(true);
    await action.run(context);

    expect(checkForPiWebUpdates).toHaveBeenCalledOnce();
  });

  it("disables the action on older hosts without the update-check helper", () => {
    const action = plugin.activate({ apiVersion: 2, pluginId: "updates", runtimePluginId: "updates", html, svg }).contributions.actions?.find((candidate) => candidate.id === "check");
    if (action === undefined) throw new Error("Expected update check action");
    const context = runtimeContext();

    expect(action.enabled?.(context)).toBe(false);
    expect(action.disabledReason?.(context)).toContain("newer PI WEB gateway");
  });
});

function runtimeContext(patch: Partial<PluginRuntimeContext> = {}): PluginRuntimeContext {
  const noop = () => undefined;
  return {
    state: {},
    prompt: { insertText: noop, getText: () => "", getSelection: () => null },
    openActionPalette: noop,
    focusPrompt: noop,
    addProject: noop,
    createProject: () => Promise.resolve(undefined),
    projectDirectories: () => Promise.resolve([]),
    projectTrust: () => Promise.resolve({ path: "", decision: null, trusted: false }),
    configureAuth: noop,
    logoutAuth: noop,
    openThemePicker: noop,
    selectMainView: noop,
    selectWorkspaceTool: noop,
    openTerminal: noop,
    refreshFiles: noop,
    refreshWorkspacePanels: noop,
    refreshAppData: noop,
    reloadPage: noop,
    startSession: noop,
    archiveSession: noop,
    stopActiveWork: noop,
    ...patch,
  };
}
