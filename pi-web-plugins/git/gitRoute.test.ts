// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { noPanelTerminal } from "../terminalSessionsTestSupport.js";
import type { WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { createGitDiffRoute } from "./browser/gitRoute.js";

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("Git panel route", () => {
  it("keeps nested deployment paths and unrelated route fields while encoding the selected Git surface", () => {
    window.history.replaceState({}, "", "/test/ai/?machine=remote-1&project=project%2Fone&workspace=workspace+one&session=s1&core.workspace--expanded=1#panel");
    const route = createGitDiffRoute("machine.remote-1.git:workspace.git");
    const context = panelContext("remote-1", "project/one", "workspace one");

    expect(route.matches(context)).toBe(true);
    route.write({ mode: "history", diffPath: undefined, commitId: "a".repeat(40), expanded: true });

    const url = new URL(window.location.href);
    expect(`${url.pathname}${url.hash}`).toBe("/test/ai/#panel");
    expect(url.searchParams.get("machine")).toBe("remote-1");
    expect(url.searchParams.get("session")).toBe("s1");
    expect(url.searchParams.get("machine.remote-1.git.workspace.git--mode")).toBe("history");
    expect(url.searchParams.get("machine.remote-1.git.workspace.git--commit")).toBe("a".repeat(40));
    expect(url.searchParams.get("core.workspace--expanded")).toBe("1");
    expect(route.read()).toEqual({ mode: "history", diffPath: undefined, commitId: "a".repeat(40), expanded: true });
  });

  it("does not retain a Changes diff when the URL selects History", () => {
    window.history.replaceState({}, "", "/?project=p1&workspace=w1&git.workspace.git--mode=history&git.workspace.git--diff=README.md");

    expect(createGitDiffRoute("git:workspace.git").read()).toEqual({ mode: "history", diffPath: undefined, commitId: undefined, expanded: false });
  });
});

function panelContext(machineId: string, projectId: string, workspaceId: string): WorkspacePanelContext {
  const noop = () => undefined;
  return {
    machine: { id: machineId, name: machineId, kind: machineId === "local" ? "local" : "remote" },
    workspace: { id: workspaceId, projectId, path: "/repo", label: "main", isMain: true },
    files: {
      readFile: () => Promise.reject(new Error("not implemented")),
      listFiles: () => Promise.reject(new Error("not implemented")),
      writeFile: () => Promise.reject(new Error("not implemented")),
      deleteFile: () => Promise.reject(new Error("not implemented")),
      moveFile: () => Promise.reject(new Error("not implemented")),
    },
    backend: { request: () => Promise.reject(new Error("not implemented")) },
    host: { requestRender: noop, workspacePanelFullscreen: () => false, setWorkspacePanelFullscreen: noop },
    prompt: { insertText: noop, getText: () => "", getSelection: () => null },
    terminal: noPanelTerminal(),
  };
}
