import type { WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";

const modeQueryKey = "mode";
const diffQueryKey = "diff";
const commitQueryKey = "commit";

export type GitPanelModeRoute = "changes" | "history";

/** The durable, shareable portion of a Git panel's workspace-scoped state. */
export interface GitPanelRouteState {
  mode: GitPanelModeRoute;
  diffPath: string | undefined;
  commitId: string | undefined;
  expanded: boolean;
}

export interface GitDiffRoute {
  matches(context: WorkspacePanelContext): boolean;
  read(): GitPanelRouteState;
  write(state: GitPanelRouteState, options?: { replace?: boolean }): void;
}

export function createGitDiffRoute(panelContributionId: string): GitDiffRoute {
  const namespace = panelContributionId.replaceAll(":", ".");
  const key = (name: string) => `${namespace}--${name}`;
  return {
    matches: routeMatchesWorkspace,
    read: () => {
      const params = new URLSearchParams(window.location.search);
      const requestedMode = params.get(key(modeQueryKey)) === "history" ? "history" : "changes";
      const commitId = nonEmpty(params.get(key(commitQueryKey)));
      const mode = commitId === undefined ? requestedMode : "history";
      return {
        mode,
        diffPath: mode === "changes" ? nonEmpty(params.get(key(diffQueryKey))) : undefined,
        commitId: mode === "history" ? commitId : undefined,
        expanded: params.get("core.workspace--expanded") === "1",
      };
    },
    write: (state, options) => {
      const url = new URL(window.location.href);
      for (const name of [modeQueryKey, diffQueryKey, commitQueryKey]) url.searchParams.delete(key(name));
      if (state.mode === "history") url.searchParams.set(key(modeQueryKey), "history");
      if (state.mode === "changes" && state.diffPath !== undefined && state.diffPath !== "") url.searchParams.set(key(diffQueryKey), state.diffPath);
      if (state.mode === "history" && state.commitId !== undefined && state.commitId !== "") url.searchParams.set(key(commitQueryKey), state.commitId);
      commitUrl(url, options?.replace === true);
    },
  };
}

function routeMatchesWorkspace(context: WorkspacePanelContext): boolean {
  const params = new URLSearchParams(window.location.search);
  return (params.get("machine") ?? "local") === context.machine.id
    && params.get("project") === context.workspace.projectId
    && params.get("workspace") === context.workspace.id;
}

function nonEmpty(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

function commitUrl(url: URL, replace: boolean): void {
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  if (replace) window.history.replaceState({}, "", url);
  else window.history.pushState({}, "", url);
}
