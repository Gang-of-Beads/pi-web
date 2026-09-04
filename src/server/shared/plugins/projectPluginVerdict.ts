import { join } from "node:path";

/**
 * Whether a workspace's own plugin directory may be loaded.
 *
 * A project-local plugin is arbitrary code that arrives with a checkout, so it
 * loads only from a project the user has trusted - the same gate pi puts in
 * front of `.pi/extensions`. The three states are named because the surface
 * has to tell them apart: an untrusted project with plugins is not the same as
 * a project with none, and neither is the same as a trusted project whose
 * directory is empty. Reporting an untrusted directory as "no plugins" is the
 * kind of silence this project has paid for before.
 */

export type ProjectPluginVerdict = "load" | "withheld-untrusted" | "absent";

export interface ProjectPluginInput {
  readonly trusted: boolean;
  readonly directoryExists: boolean;
}

export function projectPluginVerdict(input: ProjectPluginInput): ProjectPluginVerdict {
  if (!input.directoryExists) return "absent";
  return input.trusted ? "load" : "withheld-untrusted";
}

export function projectPluginDirectory(workspacePath: string): string {
  return join(workspacePath, ".pi-web", "plugins");
}

export interface ProjectPluginRootResolution {
  readonly verdict: ProjectPluginVerdict;
  readonly directory: string;
  /** Present only when the directory exists and may be read. */
  readonly root?: { path: string; source: string; scope: "local" };
  /** Present only when a directory was found and deliberately not read. */
  readonly withheld?: { source: string; message: string };
}

/**
 * Resolve one workspace's plugin directory into what discovery should do with
 * it. The withheld case carries its own message so the surface can say why a
 * plugin it can see is not running, rather than leaving the reader to guess
 * between "none", "broken" and "not allowed".
 */
export function resolveProjectPluginRoot(workspacePath: string, input: ProjectPluginInput): ProjectPluginRootResolution {
  const directory = projectPluginDirectory(workspacePath);
  const verdict = projectPluginVerdict(input);
  if (verdict === "load") return { verdict, directory, root: { path: directory, source: "project", scope: "local" } };
  if (verdict === "withheld-untrusted") {
    return {
      verdict,
      directory,
      withheld: { source: directory, message: `Plugins in ${directory} are not loaded because this project is not trusted.` },
    };
  }
  return { verdict, directory };
}
