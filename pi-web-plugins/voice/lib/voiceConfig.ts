/**
 * Voice's own configuration, owned by the plugin rather than by the core
 * config contract.
 *
 * These blocks used to live in `PiWebConfigValues`, which meant the core named
 * one plugin's keys in its own contract and every install carried the shape of
 * a feature it might not use. The plugin now declares them and receives them
 * through its activation settings; absent means unconfigured, and dictation is
 * simply not offered - sending audio somewhere is an explicit choice.
 */

export interface PiWebAzureSpeechConfig {
  region: string;
  resource?: string;
  key: string;
}

/**
 * How live transcription reaches a service.
 *
 * `browser` needs nothing configured and streams natively, but sends audio to
 * the browser vendor. The socket protocols connect from the page for latency,
 * so they take a short-lived credential minted by the server rather than an
 * API key, which must never reach a browser.
 */
export interface PiWebSpeechStreamingConfig {
  protocol: "browser" | "openai-realtime" | "deepgram" | "azure-speech";
  url?: string;
  model?: string;
  tokenEndpoint?: string;
}

/**
 * Streaming is separate from `endpoint` because it is a different protocol,
 * not a different URL: an install can have batch dictation without streaming,
 * and turning streaming on must not silently change what `endpoint` means.
 */
export interface PiWebSpeechToTextConfig {
  endpoint: string;
  model?: string;
  language?: string;
  streaming?: PiWebSpeechStreamingConfig;
}
