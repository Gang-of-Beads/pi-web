import { trustApi, workspacesApi } from "./api/clients";
import type { ProjectTrustActions } from "./components/appShell/projectTrustItem";

/**
 * A project's trust is its main workspace folder's, read and written through the id-based
 * workspace trust route on the machine that lists the project: the server resolves the path, so
 * the page never names one, and the same route serves a remote machine through its proxy.
 */
export const projectTrustActions: ProjectTrustActions = {
  get: async (machineId, projectId) => ({
    trusted: (await trustApi.workspaceTrust(projectId, await mainWorkspaceId(machineId, projectId), machineId)).trusted,
  }),
  set: async (machineId, projectId, trusted) => ({
    trusted: (await trustApi.setWorkspaceTrust(projectId, await mainWorkspaceId(machineId, projectId), trusted, machineId)).trusted,
  }),
};

async function mainWorkspaceId(machineId: string, projectId: string): Promise<string> {
  const main = (await workspacesApi.workspaces(projectId, machineId)).find((workspace) => workspace.isMain);
  if (main === undefined) throw new Error("No main workspace is listed for this project");
  return main.id;
}
