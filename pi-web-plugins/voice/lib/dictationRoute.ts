import type { PiWebSpeechToTextConfig, WholeClipAuthorization } from "./voiceConfig.js";
import { isDictationConfigured } from "./speechToText.js";
import { resolveSpeechStreaming } from "./speechStreamProtocols.js";

/**
 * How a spoken sentence reaches the composer.
 *
 * - `live`: words appear while the speaker is still talking, over a socket
 *   authenticated with the server-minted token.
 * - `whole-clip`: the clip is uploaded once the speaker stops. Only an install
 *   with no `streaming` block records this way; its `authorization` says
 *   whether the upload carries the server-minted token.
 * - `refused`: streaming is configured but cannot run; the reason is shown
 *   instead of sending the audio somewhere the install did not choose.
 * - `unconfigured`: no endpoint, so no microphone is offered.
 */
export type DictationRoute =
  | { kind: "live"; socketUrl: string }
  | { kind: "whole-clip"; authorization: WholeClipAuthorization }
  | { kind: "refused"; reason: string }
  | { kind: "unconfigured" };

export function chooseDictationRoute(config: PiWebSpeechToTextConfig | undefined): DictationRoute {
  if (!isDictationConfigured(config)) return { kind: "unconfigured" };
  if (config.streaming === undefined) return { kind: "whole-clip", authorization: config.authorization ?? "none" };
  const plan = resolveSpeechStreaming(config.streaming, config.language);
  return plan.kind === "socket" ? { kind: "live", socketUrl: plan.url } : { kind: "refused", reason: plan.reason };
}
