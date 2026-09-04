import type { PiWebSpeechToTextConfig } from "./voiceConfig.js";
import { isDictationConfigured } from "./speechToText.js";
import { resolveSpeechStreaming } from "./speechStreamProtocols.js";

/** How a spoken sentence reaches the composer. */
export const DictationRoute = {
  /** Words appear while the speaker is still talking. */
  live: "live",
  /** The clip is uploaded once the speaker stops. */
  wholeClip: "whole-clip",
  unavailable: "unavailable",
} as const;

export type DictationRoute = (typeof DictationRoute)[keyof typeof DictationRoute];

export function chooseDictationRoute(config: PiWebSpeechToTextConfig | undefined): DictationRoute {
  if (!isDictationConfigured(config)) return DictationRoute.unavailable;
  return resolveSpeechStreaming(config.streaming).kind === "unavailable" ? DictationRoute.wholeClip : DictationRoute.live;
}
