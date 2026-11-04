import { realpathSync } from "node:fs";
import { ProjectTrustStore, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ProjectTrustDefault } from "../../../shared/apiTypes.js";

/**
 * Whether a project directory is trusted, read the way pi keys its own
 * decisions.
 *
 * Two surfaces need this answer - the trust routes the user reads and writes
 * through, and plugin discovery deciding whether a project's own plugins may
 * run. A second implementation of "is this trusted" is a second producer of a
 * security decision, and the two would answer differently the first time the
 * keying rules changed.
 *
 * The path is resolved with the SDK's tolerant sync resolution: async realpath
 * uses the native Windows resolution, which expands 8.3 short names such as
 * `RUNNER~1` and would miss keys stored under the short form.
 */

export interface ProjectTrustDecision {
  readonly path: string;
  /** Raw stored decision: true/false for an explicit entry, null when unset. */
  readonly decision: boolean | null;
  readonly trusted: boolean;
  /**
   * The agent directory's global `defaultProjectTrust`, which decides when no decision is saved. A
   * project cannot set its own, so its `.pi/settings.json` is left closed, as pi leaves it before
   * trust is decided.
   */
  readonly defaultTrust: ProjectTrustDefault;
}

export function decidedTrustPath(raw: string, expandUserPath: (value: string) => string): string {
  const expanded = expandUserPath(raw.trim());
  try {
    return realpathSync(expanded);
  } catch {
    return expanded;
  }
}

export function readProjectTrust(path: string, agentDir: string): ProjectTrustDecision {
  const decision = new ProjectTrustStore(agentDir).get(path) ?? null;
  const defaultTrust = SettingsManager.create(path, agentDir, { projectTrusted: false }).getDefaultProjectTrust();
  return { path, decision, trusted: decision ?? defaultTrust === "always", defaultTrust };
}

/** Writes go through the SDK store's file lock; a refusal surfaces to the caller. */
export function writeProjectTrust(path: string, agentDir: string, trusted: boolean): void {
  new ProjectTrustStore(agentDir).set(path, trusted);
}
