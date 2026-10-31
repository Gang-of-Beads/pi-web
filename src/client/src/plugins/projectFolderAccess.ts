import { PROJECT_FOLDER_NAME_REFUSED_CODE, ROUTE_MISSING_CODE, type Project, type ProjectFolderListingRequest } from "../../../shared/apiTypes";
import type { projectsApi, trustApi } from "../api/clients";
import { HttpError } from "../api/http";
import { describeError } from "../notice";
import type { PluginProjectCreateInput, PluginProjectFolderReply, PluginProjectFolders } from "./types";

export interface ProjectFolderAccessSources {
  readonly machine: PluginProjectFolders["machine"];
  readonly projects: Pick<typeof projectsApi, "projectFolder" | "projectDirectories">;
  readonly trust: Pick<typeof trustApi, "projectTrust">;
  readonly create: (machineId: string, input: PluginProjectCreateInput) => Promise<string | undefined>;
  /** The projects the bound machine listed last, read at each lookup so a project added meanwhile counts. */
  readonly listedProjects: () => readonly Pick<Project, "name" | "path">[];
}

/**
 * The add-project dialog's folder access, bound to the machine given here once. The dialog keeps
 * this object for its life, so a machine selected while it is open cannot redirect a listing, a
 * trust read or the final add (r67).
 */
export function projectFolderAccess(sources: ProjectFolderAccessSources): PluginProjectFolders {
  const machineId = sources.machine.id;
  return {
    machine: sources.machine,
    listFolder: async (request, signal) => {
      try {
        return { kind: "listed", machineId, listing: await sources.projects.projectFolder(request, machineId, { signal }) };
      } catch (error) {
        if (signal.aborted) throw error;
        return folderFailureReply(machineId, request, error);
      }
    },
    directories: (query, signal) => sources.projects.projectDirectories(query, machineId, { signal }),
    trust: (path) => sources.trust.projectTrust(path, machineId),
    create: (input) => sources.create(machineId, input),
    projectAt: (path) => {
      const folder = withoutTrailingSeparator(path);
      return sources.listedProjects().find((project) => withoutTrailingSeparator(project.path) === folder);
    },
  };
}

function withoutTrailingSeparator(path: string): string {
  return path.endsWith("/") || path.endsWith("\\") ? path.slice(0, -1) : path;
}

/** A listing that did not come back, typed: a machine too old for the route, a refused new name, or no usable answer. */
function folderFailureReply(machineId: string, request: ProjectFolderListingRequest, error: unknown): PluginProjectFolderReply {
  if (error instanceof HttpError && error.code === ROUTE_MISSING_CODE) return { kind: "unsupported", machineId };
  if (error instanceof HttpError && error.code === PROJECT_FOLDER_NAME_REFUSED_CODE && request.child !== undefined) return { kind: "name-refused", machineId, reason: error.message };
  return { kind: "unanswered", machineId, reason: describeError(error) };
}
