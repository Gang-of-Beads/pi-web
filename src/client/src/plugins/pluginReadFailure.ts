import type { PluginReadFailure } from "../../../shared/pluginApiTypes";
import { describeError } from "../notice";
import { classifyReadError, QUIET_WINDOW_MS, retryDelayMs } from "../sync/readPhase";

/**
 * The host's B48 answer for a plugin's failed read, so a plugin's panel follows the same rule as the
 * app's own surfaces instead of turning every failure into a red line. The terminal showed "The server
 * did not answer within 30s." in red for a read the page could only wait out (owner, 2026-10-13).
 * The decision itself is `classifyReadError`'s; this only words it for a plugin.
 */
export function pluginReadFailure(error: unknown, attempt: number): PluginReadFailure {
  const outcome = classifyReadError(error);
  if (outcome.kind === "fact") return { kind: "final", words: describeError(error) };
  const delayMs = retryDelayMs(attempt, QUIET_WINDOW_MS);
  return outcome.miss.kind === "server-error" ? { kind: "retry", delayMs, reason: outcome.miss.reason } : { kind: "retry", delayMs };
}
