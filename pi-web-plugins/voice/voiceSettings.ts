import type { PluginSettings } from "@gang-of-beads/pi-web/plugin-api";
import type { PiWebSpeechStreamingConfig, PiWebSpeechToTextConfig } from "./lib/voiceConfig.js";

/**
 * Read the plugin's own configuration block.
 *
 * Unconfigured is a state, not a failure: dictation is simply not offered,
 * because sending audio somewhere must be an explicit choice. A malformed
 * block is treated as unconfigured for the same reason - offering a microphone
 * that cannot reach anything is worse than not offering one.
 */

const protocols: readonly PiWebSpeechStreamingConfig["protocol"][] = ["browser", "openai-realtime", "deepgram", "azure-speech"];

export function parseVoiceSettings(settings: PluginSettings | undefined): PiWebSpeechToTextConfig | undefined {
  if (settings === undefined) return undefined;
  const endpoint = settings["endpoint"];
  if (typeof endpoint !== "string" || endpoint.trim() === "") return undefined;
  const model = settings["model"];
  const language = settings["language"];
  const streaming = parseStreaming(settings["streaming"]);
  return {
    endpoint,
    ...(typeof model === "string" ? { model } : {}),
    ...(typeof language === "string" ? { language } : {}),
    ...(streaming === undefined ? {} : { streaming }),
  };
}

function parseStreaming(value: unknown): PiWebSpeechStreamingConfig | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record: Record<string, unknown> = { ...value };
  const protocol = record["protocol"];
  if (typeof protocol !== "string" || !isProtocol(protocol)) return undefined;
  const url = record["url"];
  const model = record["model"];
  const tokenEndpoint = record["tokenEndpoint"];
  return {
    protocol,
    ...(typeof url === "string" ? { url } : {}),
    ...(typeof model === "string" ? { model } : {}),
    ...(typeof tokenEndpoint === "string" ? { tokenEndpoint } : {}),
  };
}

function isProtocol(value: string): value is PiWebSpeechStreamingConfig["protocol"] {
  return protocols.some((candidate) => candidate === value);
}
