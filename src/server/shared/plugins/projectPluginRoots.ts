import { existsSync } from "node:fs";
import { projectPluginDirectory, resolveProjectPluginRoot, type ProjectPluginRootResolution } from "./projectPluginVerdict.js";
import { readProjectTrust } from "./projectTrustReader.js";

/**
 * Turn the projects this machine knows about into what discovery should do
 * with each one's plugin directory.
 *
 * Trust is read per project rather than once, because a project the user has
 * not trusted must not benefit from a sibling that is trusted; the directory
 * check is what keeps an ordinary project from producing a diagnostic it has
 * no reason to produce.
 */

export interface ProjectPluginRootsInput {
  projectPaths: () => Promise<readonly string[]> | readonly string[];
  agentDir: () => Promise<string> | string;
  directoryExists?: (path: string) => boolean;
  trustOf?: (path: string, agentDir: string) => { trusted: boolean };
}

export async function projectPluginRoots(input: ProjectPluginRootsInput): Promise<ProjectPluginRootResolution[]> {
  const directoryExists = input.directoryExists ?? ((path: string) => existsSync(path));
  const trustOf = input.trustOf ?? readProjectTrust;
  const agentDir = await input.agentDir();
  const resolutions: ProjectPluginRootResolution[] = [];
  const seen = new Set<string>();
  for (const path of await input.projectPaths()) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (!directoryExists(projectPluginDirectory(path))) continue;
    resolutions.push(resolveProjectPluginRoot(path, { trusted: trustOf(path, agentDir).trusted, directoryExists: true }));
  }
  return resolutions;
}
