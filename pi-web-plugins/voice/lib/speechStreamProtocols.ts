import type { PiWebSpeechStreamingConfig } from "./voiceConfig.js";
import { SPEECH_DELTA_MODES, type SpeechDeltaMode } from "./speechTranscriptBuffer.js";
/**
 * Decoding one streaming-transcription message into what the composer needs.
 *
 * Each service speaks its own protocol, but a dictating user only ever needs
 * three things from any of them: text that replaces the current guess, text
 * that is settled, and a failure worth showing. Keeping the decode pure means
 * a protocol can be verified against its documented message shapes without a
 * microphone, a socket, or an account.
 */
export type SpeechStreamProtocol = "openai-realtime" | "deepgram" | "azure-speech";

export type SpeechStreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "final"; text: string }
  | { kind: "error"; message: string };

export function decodeSpeechStreamEvent(
  protocol: SpeechStreamProtocol,
  message: unknown,
): SpeechStreamEvent | undefined {
  if (!isRecord(message)) return undefined;
  if (protocol === "openai-realtime") return decodeOpenAiRealtime(message);
  if (protocol === "azure-speech") return decodeAzureSpeech(message);
  return decodeDeepgram(message);
}

/**
 * Azure's socket speaks a different vocabulary again: a hypothesis while the
 * phrase is still forming, and a recognised phrase once it settles. Hypotheses
 * re-send the whole phrase, so they replace rather than append.
 */
function decodeAzureSpeech(message: Record<string, unknown>): SpeechStreamEvent | undefined {
  const type = stringAt(message, "Type");
  if (type === "speech.hypothesis") {
    const text = stringAt(message, "Text");
    return text === undefined || text === "" ? undefined : { kind: "delta", text };
  }
  if (type !== "speech.phrase") return undefined;
  const status = stringAt(message, "RecognitionStatus");
  if (status === "Error") return { kind: "error", message: "Speech recognition reported an error." };
  // NoMatch arrives on the silence between phrases; treating it as an empty
  // final would wipe what had already been dictated.
  if (status !== "Success") return undefined;
  const text = stringAt(message, "DisplayText");
  return text === undefined || text === "" ? undefined : { kind: "final", text };
}

function decodeOpenAiRealtime(message: Record<string, unknown>): SpeechStreamEvent | undefined {
  const type = stringAt(message, "type");
  if (type === "conversation.item.input_audio_transcription.delta") {
    const text = stringAt(message, "delta");
    return text === undefined || text === "" ? undefined : { kind: "delta", text };
  }
  if (type === "conversation.item.input_audio_transcription.completed") {
    const text = stringAt(message, "transcript");
    return text === undefined ? undefined : { kind: "final", text };
  }
  if (type === "error") {
    const error = message["error"];
    const detail = isRecord(error) ? stringAt(error, "message") : undefined;
    return { kind: "error", message: detail ?? "Transcription failed." };
  }
  return undefined;
}

function decodeDeepgram(message: Record<string, unknown>): SpeechStreamEvent | undefined {
  if (stringAt(message, "type") !== "Results") return undefined;
  const channel = message["channel"];
  if (!isRecord(channel)) return undefined;
  const alternatives: unknown = channel["alternatives"];
  if (!Array.isArray(alternatives)) return undefined;
  const first: unknown = alternatives.at(0);
  const text = isRecord(first) ? stringAt(first, "transcript") : undefined;
  // Empty interim results arrive between phrases; treating them as text would
  // blank the composer in the middle of a sentence.
  if (text === undefined || text === "") return undefined;
  return message["is_final"] === true ? { kind: "final", text } : { kind: "delta", text };
}

function stringAt(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Which live-transcription path an install has actually configured.
 *
 * A half-configured socket protocol reports why rather than falling back to
 * something else: dictating into a different service than the one an install
 * chose is worse than not dictating at all. In particular, a socket protocol
 * with no token endpoint is refused, because the only other way to
 * authenticate from a page would be to ship a long-lived account key to it.
 */
export type SpeechStreamingPlan =
  | { kind: "browser" }
  | {
      kind: "socket";
      protocol: SpeechStreamProtocol;
      url: string;
      tokenEndpoint: string;
      deltaMode: SpeechDeltaMode;
    }
  | { kind: "unavailable"; reason: string };

export function resolveSpeechStreaming(
  config: PiWebSpeechStreamingConfig | undefined,
  languageHint?: string,
): SpeechStreamingPlan {
  if (config === undefined) return { kind: "unavailable", reason: "Live transcription is not configured." };
  if (config.protocol === "browser") return { kind: "browser" };
  const url = config.url?.trim();
  if (url === undefined || url === "") {
    return { kind: "unavailable", reason: "Streaming transcription needs a socket url." };
  }
  const tokenEndpoint = config.tokenEndpoint?.trim();
  if (tokenEndpoint === undefined || tokenEndpoint === "") {
    return {
      kind: "unavailable",
      reason: "Streaming transcription needs a token endpoint so the account key stays on the server.",
    };
  }
  // Azure's live endpoint rejects the handshake with "Invalid CID or
  // language" (HTTP 400) when the configured language is absent, so it rides
  // along here — the same value the whole-clip route posts.
  const language = languageHint?.trim();
  const handshakeUrl = language === undefined || language === ""
    ? url
    : `${url}${url.includes("?") ? "&" : "?"}language=${encodeURIComponent(language)}`;
  return {
    kind: "socket",
    protocol: config.protocol,
    url: handshakeUrl,
    tokenEndpoint,
    deltaMode: SPEECH_DELTA_MODES[config.protocol],
  };
}
