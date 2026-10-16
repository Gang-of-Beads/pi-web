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


/**
 * How live transcription reaches a service.
 *
 * The socket connects from the page for latency, so it takes a short-lived
 * token minted by this plugin's server half rather than an API key, which must
 * never reach a browser. Only `azure-speech` streams in this version; the other
 * protocols are accepted so an install that names one is told why it does not
 * stream. A `tokenEndpoint` key is ignored: the token always comes from the
 * plugin's own `speech.token` operation.
 */
export interface PiWebSpeechStreamingConfig {
  protocol: "browser" | "openai-realtime" | "deepgram" | "azure-speech";
  url?: string;
  model?: string;
}

/**
 * How a whole-clip upload authenticates. `speech-token` is an install that
 * names an `azureSpeech` block: every upload carries a short-lived token from
 * the plugin's server half, and none is sent without one. `none` (also when the
 * field is absent) means the endpoint takes no credential, such as a keyless
 * service on the same host.
 */
export type WholeClipAuthorization = "speech-token" | "none";

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
  authorization?: WholeClipAuthorization;
}
