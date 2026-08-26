import type { Machine, Project, SessionInfo, Workspace } from "./api";
import { sessionLabel } from "./sessionLabels";

/**
 * What the browser tab and the app header should be called.
 *
 * "PI WEB" is the one thing a reader already knows - the tab is open, the app
 * is on screen. What it cannot see from a background tab is which context is
 * focused, so the name is the most specific piece of the current selection:
 * the session being read, else the workspace, else the project, else the
 * machine. The product name is the fallback for an empty gateway.
 */
export interface ContextNameInput {
  mainView: string;
  selectedMachine?: Pick<Machine, "name" | "kind"> | undefined;
  selectedProject?: Pick<Project, "name"> | undefined;
  selectedWorkspace?: Pick<Workspace, "label"> | undefined;
  selectedSession?: SessionInfo | undefined;
}

export const PRODUCT_NAME = "PI WEB";

/** The trailing part of a path-like workspace label, which is what identifies it. */
function workspaceName(workspace: Pick<Workspace, "label"> | undefined): string | undefined {
  const raw = workspace?.label.trim();
  if (raw === undefined || raw === "") return undefined;
  const tail = raw.split("/").filter((part) => part !== "").pop();
  return tail ?? raw;
}

/**
 * The focused context, most specific first. Chat is about one session, so the
 * session wins there; every other view is about the container the reader is
 * browsing, so the deepest selected container names it.
 */
export function focusedContextName(input: ContextNameInput): string {
  if (input.mainView === "chat" && input.selectedSession !== undefined) {
    const label = sessionLabel(input.selectedSession).trim();
    if (label !== "") return label;
  }
  const workspace = workspaceName(input.selectedWorkspace);
  if (workspace !== undefined) return workspace;
  const project = input.selectedProject?.name.trim();
  if (project !== undefined && project !== "") return project;
  // A local machine is where the reader already is; naming the tab "Local"
  // says less than the product name does.
  const machine = input.selectedMachine;
  if (machine !== undefined && machine.kind !== "local") {
    const name = machine.name.trim();
    if (name !== "") return name;
  }
  return PRODUCT_NAME;
}

/**
 * The document title. A single long session name fills a tab strip, so it is
 * bounded; the product name is dropped once a context exists because the tab
 * favicon and the page already say which app this is.
 */
export function documentTitleFor(input: ContextNameInput, maxLength = 40): string {
  const name = focusedContextName(input);
  if (name.length <= maxLength) return name;
  return `${name.slice(0, maxLength - 1).trimEnd()}…`;
}
