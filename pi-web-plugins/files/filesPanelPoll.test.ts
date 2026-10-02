// @vitest-environment happy-dom

import { html, render, svg } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileTreeResponse, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { stubWorkspaceFiles } from "../../src/client/src/plugins/workspaceFilesTestSupport.js";
import { noPanelTerminal } from "../terminalSessionsTestSupport.js";
import plugin from "./pi-web-plugin.js";
import { FILES_POLL_INTERVAL_MS } from "./shownPoll.js";

/**
 * Files re-reads its tree by itself while its page is on screen (owner, 2026-10-02; state-diagram
 * D5, "Workspace pages stay fresh while someone looks"), and stops when the page leaves.
 */
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("the Files page reads its tree while it is on screen", () => {
  it("re-reads every interval while mounted and stops once it is gone", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", undefined);
    const listFiles = vi.fn<(path: string) => Promise<FileTreeResponse>>((path) => Promise.resolve({ path, entries: [], scannedAt: "2026-10-02T00:00:00.000Z", truncated: false }));
    const context: WorkspacePanelContext = {
      machine: { id: "local", name: "Local", kind: "local" },
      workspace: { id: "ws-1", projectId: "project-1", path: "/repo", label: "repo", isMain: true },
      files: stubWorkspaceFiles({ listFiles }),
      host: { requestRender: () => undefined, workspacePanelFullscreen: () => false, setWorkspacePanelFullscreen: () => undefined },
      prompt: { insertText: () => undefined, getText: () => "", getSelection: () => null },
      terminal: noPanelTerminal(),
    };
    const panel = plugin.activate({ apiVersion: 2, pluginId: "files", runtimePluginId: "files", html, svg }).contributions.workspacePanels?.[0];
    if (panel === undefined) throw new Error("no Files panel");
    const host = document.createElement("div");
    document.body.append(host);
    render(panel.render(context), host);
    await vi.advanceTimersByTimeAsync(0);
    const opened = listFiles.mock.calls.length;

    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS * 3);
    const whileShown = listFiles.mock.calls.length - opened;
    render(html``, host);
    const removedFrom = listFiles.mock.calls.length;
    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS * 3);

    expect({ opened: opened > 0, whileShown, afterRemoval: listFiles.mock.calls.length - removedFrom }).toEqual({ opened: true, whileShown: 3, afterRemoval: 0 });
  });
});
