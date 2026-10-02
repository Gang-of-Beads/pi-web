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

/**
 * The Files page as the host mounts it: the panel, its toolbar and the settled-turn hook. Reads
 * answer through `answer`, which a test swaps to fail or to hold a read on its way.
 */
function mountFiles(listFiles: (path: string) => Promise<FileTreeResponse>) {
  let settle: (() => void) | undefined;
  const context: WorkspacePanelContext = {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: "ws-1", projectId: "project-1", path: "/repo", label: "repo", isMain: true },
    files: stubWorkspaceFiles({ listFiles }),
    host: { requestRender: () => undefined, workspacePanelFullscreen: () => false, setWorkspacePanelFullscreen: () => undefined },
    prompt: { insertText: () => undefined, getText: () => "", getSelection: () => null },
    terminal: noPanelTerminal(),
  };
  const activation = plugin.activate({ apiVersion: 2, pluginId: "files", runtimePluginId: "files", html, svg, on: (kind, listener) => {
    if (kind === "session-activity-settled") settle = () => { Reflect.apply(listener, undefined, [{ kind, sessionId: "session-1", machineId: "local" }]); };
    return () => undefined;
  } });
  const panel = activation.contributions.workspacePanels?.[0];
  if (panel?.toolbar === undefined) throw new Error("no Files panel toolbar");
  const toolbar = panel.toolbar;
  const page = document.createElement("div");
  const bar = document.createElement("div");
  document.body.append(bar, page);
  render(panel.render(context), page);
  return {
    settle: () => { settle?.(); },
    outOfDate: () => {
      render(toolbar(context), bar);
      return bar.textContent.includes("out of date");
    },
  };
}

const emptyListing = (path: string): FileTreeResponse => ({ path, entries: [], scannedAt: "2026-10-02T00:00:00.000Z", truncated: false });

describe("the toolbar's out of date says what the shown tree is", () => {
  it("stays up while reads fail, and goes once a read lands", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", undefined);
    let reachable = true;
    const files = mountFiles((path) => reachable ? Promise.resolve(emptyListing(path)) : Promise.reject(new Error("machine unreachable")));
    await vi.advanceTimersByTimeAsync(0);
    reachable = false;
    files.settle();

    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS);
    const afterFailedRead = files.outOfDate();
    reachable = true;
    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS);

    expect({ afterFailedRead, afterLandedRead: files.outOfDate() }).toEqual({ afterFailedRead: true, afterLandedRead: false });
  });

  it("stays up when the turn settles while a read is already on its way", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", undefined);
    let hold: ((listing: FileTreeResponse) => void) | undefined;
    let holding = false;
    const files = mountFiles((path) => holding ? new Promise((resolve) => { hold = resolve; }) : Promise.resolve(emptyListing(path)));
    await vi.advanceTimersByTimeAsync(0);
    holding = true;
    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS);
    holding = false;
    files.settle();
    hold?.(emptyListing(""));
    await vi.advanceTimersByTimeAsync(0);
    const afterEarlierRead = files.outOfDate();

    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS);

    expect({ afterEarlierRead, afterNextRead: files.outOfDate() }).toEqual({ afterEarlierRead: true, afterNextRead: false });
  });
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
