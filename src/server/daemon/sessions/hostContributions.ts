/**
 * The one seam through which the host (PI WEB) contributes to what an agent
 * session receives. Every prompt addition, tool change and surface rewrite
 * the host makes must be registered here and consumed from here, so a
 * contribution added anywhere else cannot reach the model - and so the host's
 * deviations from the native TUI are enumerable as data, not folklore.
 *
 * The enumeration is the contract for neutrality: matching the TUI means
 * reducing these rows to empty, each one resolved in code or documented for
 * the human - never kept as prose in the prompt.
 */

export interface HostContributions {
  /** System prompt sections appended after the operator's own files. */
  readonly systemPromptSections: readonly string[];
  /**
   * Interactive surfaces the browser cannot draw. Requests for them are
   * answered for the human in the browser (a notification or a real dialog);
   * what the extension's call resolves to is announced, never silent.
   */
  readonly unsupportedSurfaces: readonly string[];
  /**
   * Extension files loaded into every session besides pi's own discovery. Only a test stack sets
   * any (`PI_WEB_DEBUG_EXTENSION_PATHS`), so its fixtures stay out of the operator's own pi.
   */
  readonly extensionPaths?: readonly string[];
}

export const EMPTY_HOST_CONTRIBUTIONS: HostContributions = {
  systemPromptSections: [],
  unsupportedSurfaces: [],
};

/** One row of the host-vs-native deviation list. */
export interface HostDeviation {
  readonly kind: "prompt-addition" | "surface-interception" | "extension-addition";
  readonly detail: string;
}

/** Derive the deviation list from the contributions themselves. */
export function describeHostContributions(contributions: HostContributions): HostDeviation[] {
  const rows: HostDeviation[] = contributions.systemPromptSections.map((section) => ({
    kind: "prompt-addition" as const,
    detail: section,
  }));
  for (const surface of contributions.unsupportedSurfaces) {
    rows.push({ kind: "surface-interception", detail: surface });
  }
  for (const extensionPath of contributions.extensionPaths ?? []) {
    rows.push({ kind: "extension-addition", detail: extensionPath });
  }
  return rows;
}

/** The extension files a test stack names in `PI_WEB_DEBUG_EXTENSION_PATHS`, separated like PATH. */
export function debugExtensionPaths(env: Readonly<Record<string, string | undefined>>, separator: string): readonly string[] {
  return (env["PI_WEB_DEBUG_EXTENSION_PATHS"] ?? "").split(separator).filter((entry) => entry !== "");
}
