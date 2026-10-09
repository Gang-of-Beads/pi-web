import { api as defaultApi, type Project } from "../api";
import { errorNoticePatch } from "../errorNotice";
import { describeError } from "../notice";
import { HttpError } from "../api/http";
import { PROJECT_FOLDER_REFUSALS, type ProjectFolderRefusal } from "../../../shared/apiTypes";
import { QUIET_WINDOW_MS, type ReadFact } from "../sync/readPhase";
import { ScopedResource, type ResourceClock, type Unanswered } from "../sync/scopedResource";
import { selectedMachineId, type GetState, type SetState } from "./types";
import { orderedById } from "../../../shared/listOrder";
import type { WorkspaceController } from "./workspaceController";

/**
 * Trust choice the add-project dialog submits with the path. `changed` is
 * false for the pre-filled existing/default value, so adding a project never
 * pins a decision the user did not make in this dialog.
 */
export interface ProjectTrustChoice {
  trusted: boolean;
  changed: boolean;
}

export interface ProjectControllerDependencies {
  api?: Pick<typeof defaultApi, "projects" | "addProject" | "reorderProjects" | "closeProject" | "setWorkspaceTrust">;
  clock?: ResourceClock;
  /** Called whenever a listing changes phase or value, so the app row can re-decide. */
  onListingChange?: () => void;
}


/**
 * A refusal the machine stated, in the reader's words. Shown as a notice until
 * typed facts reach the app row (object model §0): a refusal is an answer, so
 * it must not read as silence.
 */
const FACT_WORDS = new Map<ReadFact["kind"], string>([
  ["signed-out", "This machine asked you to sign in before it lists its projects."],
  ["forbidden", "This machine refused to list its projects."],
]);

export class ProjectController {
  private readonly api: Pick<typeof defaultApi, "projects" | "addProject" | "reorderProjects" | "closeProject" | "setWorkspaceTrust">;
  /** The projects of each machine, read until answered (B48). This controller is its only writer. */
  private readonly listings: ScopedResource<string, Project[]>;
  private watched: { machineId: string; release: () => void } | undefined;
  private browsed: { machineId: string; release: () => void } | undefined;
  private mirrored: Project[] | undefined;
  private noticedFact: ReadFact["kind"] = "none";

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    private readonly workspaces: Pick<WorkspaceController, "selectProject" | "forgetProject" | "clearSelection">,
    deps: ProjectControllerDependencies = {},
  ) {
    this.api = deps.api ?? defaultApi;
    this.listings = new ScopedResource<string, Project[]>({
      keyId: (machineId) => machineId,
      read: (machineId) => this.api.projects(machineId),
      retryCapMs: QUIET_WINDOW_MS,
      ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    });
    this.listings.subscribe(() => {
      this.mirror();
      deps.onListingChange?.();
    });
  }

  /**
   * Read the selected machine's projects. It resolves once this attempt settles;
   * an attempt that got no answer keeps being retried in the background, and
   * the rows appear when one comes. Nothing here writes an error: a lost answer
   * is reconnecting, which only the app row says (B48).
   */
  async loadProjects() {
    const machineId = selectedMachineId(this.getState());
    this.watch(machineId);
    this.mirror();
    await this.listings.refresh(machineId);
  }

  /**
   * A machine's projects once it answers, for a reader that needs them before
   * it can act (placing a session opened from another project). Undefined when
   * the reader stopped wanting them first, or the machine refused.
   */
  async answeredProjects(machineId: string, wanted: () => boolean): Promise<readonly Project[] | undefined> {
    const view = await this.listings.whenAnswered(machineId, wanted);
    return view?.data;
  }

  /**
   * Read the projects of a machine a list browses without selecting it (the Navigate page's machine
   * pick), and keep reading them while it is browsed, which outlives the page closing: the page
   * reopens on it. Browsing the machine selected at the call releases the browsed machine's watch,
   * since the selected machine's listing is watched already.
   */
  browse(machineId: string): void {
    const target = machineId === selectedMachineId(this.getState()) ? undefined : machineId;
    if (this.browsed?.machineId === target) return;
    this.browsed?.release();
    this.browsed = target === undefined ? undefined : { machineId: target, release: this.listings.watch(target) };
    if (target !== undefined) void this.listings.refresh(target);
  }

  /** A machine's projects as it last answered; undefined until it has. */
  listed(machineId: string): readonly Project[] | undefined {
    return this.listings.entry(machineId).data;
  }

  /** A sign of life: retry a lost projects read now instead of waiting out the backoff. */
  wake(): void {
    this.listings.wake();
  }

  dispose(): void {
    this.listings.dispose();
  }

  /** Since when the selected machine's projects have gone without an answer, and why, for the app row. */
  unanswered(): Unanswered | undefined {
    return this.listings.unanswered([selectedMachineId(this.getState())]);
  }

  private watch(machineId: string): void {
    if (this.watched?.machineId === machineId) return;
    this.watched?.release();
    this.watched = { machineId, release: this.listings.watch(machineId) };
    this.mirrored = undefined;
  }

  /** Show the selected machine's listing as it stands: rows only from its own answer, and never a "failed". */
  private mirror(): void {
    const machineId = selectedMachineId(this.getState());
    const entry = this.listings.entry(machineId);
    this.noticeFact(entry.fact.kind);
    const projectsLoad = entry.known ? "loaded" as const : "loading" as const;
    if (!entry.known || entry.data === undefined || entry.data === this.mirrored) {
      if (this.getState().projectsLoad !== projectsLoad) this.setState({ projectsLoad });
      return;
    }
    const projects = entry.data;
    this.mirrored = projects;
    const projectIds = new Set(projects.map((project) => project.id));
    const workspacesByProjectId = Object.fromEntries(Object.entries(this.getState().workspacesByProjectId).filter(([projectId]) => projectIds.has(projectId)));
    this.setState({ projects, workspacesByProjectId, projectsLoad });
  }

  private noticeFact(kind: ReadFact["kind"]): void {
    if (kind === this.noticedFact) return;
    this.noticedFact = kind;
    const words = FACT_WORDS.get(kind);
    if (words !== undefined) this.setState(errorNoticePatch(new Error(words)));
  }

  /**
   * Add a project, reporting failure to the caller rather than to the global
   * banner: the dialog stays open on failure, and a message rendered behind it
   * is a message nobody reads - the submit looked like it did nothing.
   */
  async addProject(path: string, create?: boolean, trustChoice?: ProjectTrustChoice): Promise<string | undefined> {
    if (path.trim() === "") return undefined;
    const machineId = selectedMachineId(this.getState());
    try {
      const project = await this.api.addProject(path.trim(), undefined, create, machineId);
      if (selectedMachineId(this.getState()) !== machineId) return undefined;
      const projects = this.getState().projects;
      this.listings.update(machineId, (listed) => [...listed.filter((p) => p.id !== project.id), project]);
      this.setState({ projects: [...projects.filter((p) => p.id !== project.id), project] });
      await this.workspaces.selectProject(project);
      if (trustChoice?.changed === true) {
        await this.applyTrustChoice(project, trustChoice.trusted, machineId);
      }
      return undefined;
    } catch (error) {
      return addProjectFailureMessage(error);
    }
  }

  /**
   * Pin the dialog's trust choice once the project's main workspace exists.
   * The write goes through the id-based trust route (server-resolved path),
   * never a client-chosen path; without a main workspace the project simply
   * keeps its default trust.
   */
  private async applyTrustChoice(project: Project, trusted: boolean, machineId: string): Promise<void> {
    const mainWorkspace = this.getState().workspaces.find((workspace) => workspace.isMain);
    if (mainWorkspace === undefined) return;
    await this.api.setWorkspaceTrust(project.id, mainWorkspace.id, trusted, machineId);
  }

  /** The projects in the order the reader dragged them into (R11): on the page at once, then the machine's answer. */
  async reorderProjects(order: readonly string[]): Promise<void> {
    const machineId = selectedMachineId(this.getState());
    const before = this.getState().projects.map((project) => project.id);
    this.listings.update(machineId, (listed) => orderedById(listed, order));
    this.setState({ projects: orderedById(this.getState().projects, order) });
    try {
      const answered = await this.api.reorderProjects(order, machineId);
      if (selectedMachineId(this.getState()) !== machineId) return;
      this.listings.update(machineId, () => answered);
      this.setState({ projects: answered });
    } catch (error) {
      if (selectedMachineId(this.getState()) !== machineId) return;
      this.listings.update(machineId, (listed) => orderedById(listed, before));
      this.setState({ projects: orderedById(this.getState().projects, before), ...errorNoticePatch(error) });
    }
  }

  async closeProject(projectId: string) {
    const machineId = selectedMachineId(this.getState());
    try {
      await this.api.closeProject(projectId, machineId);
      if (selectedMachineId(this.getState()) !== machineId) return undefined;
      this.workspaces.forgetProject(projectId);
      this.listings.update(machineId, (listed) => listed.filter((p) => p.id !== projectId));
      const state = this.getState();
      this.setState({ projects: state.projects.filter((p) => p.id !== projectId) });
      if (state.selectedProject?.id === projectId) this.workspaces.clearSelection();
    } catch (error) {
      if (selectedMachineId(this.getState()) === machineId) this.setState(errorNoticePatch(error));
    }
  }
}

const FOLDER_REFUSAL_WORDS: Readonly<Record<ProjectFolderRefusal, string>> = {
  "folder-missing": "That folder does not exist. Tick \u201cCreate the folder if it does not exist\u201d to make it, or correct the path.",
  "not-a-folder": "That path is a file, not a folder.",
  "folder-unreadable": "That folder cannot be read with this account's permissions.",
};

/**
 * What went wrong, in words that name the next action.
 *
 * The machine answers a folder it cannot add with a typed code (B16): the folder is not there (and
 * the dialog has a checkbox that would create it), it is a file, or this account cannot read it.
 * A machine that predates the code sends only the raw errno text (ENOENT, ENOTDIR, EACCES or EPERM), which is still read
 * until every machine carries the code (rolling compatibility, like `sessionNotFound.ts`).
 */
export function addProjectFailureMessage(error: unknown): string {
  const refusal = folderRefusalOf(error);
  if (refusal !== undefined) return FOLDER_REFUSAL_WORDS[refusal];
  return describeError(error).replace(/^Error:\s*/u, "");
}

function folderRefusalOf(error: unknown): ProjectFolderRefusal | undefined {
  if (!(error instanceof HttpError)) return undefined;
  const typed = PROJECT_FOLDER_REFUSALS.find((refusal) => refusal === error.code);
  if (typed !== undefined) return typed;
  return error.code === undefined ? legacyFolderRefusal(describeError(error)) : undefined;
}

function legacyFolderRefusal(text: string): ProjectFolderRefusal | undefined {
  if (/ENOENT|no such file or directory/u.test(text)) return "folder-missing";
  if (text.includes("ENOTDIR")) return "not-a-folder";
  if (/EACCES|EPERM/u.test(text)) return "folder-unreadable";
  return undefined;
}
