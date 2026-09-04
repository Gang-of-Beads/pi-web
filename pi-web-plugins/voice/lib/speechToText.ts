import type { PiWebSpeechToTextConfig } from "./voiceConfig.js";

/**
 * Sending recorded speech for transcription.
 *
 * Deliberately generic: the endpoint is whatever the user configured, so this
 * accepts the shape a Whisper-style HTTP service uses (multipart audio in, JSON
 * text out) and tolerates the small variations between them rather than
 * hard-coding one vendor.
 *
 * Every failure returns a message the composer can show. A dictation control
 * that silently does nothing is the worst version of this feature, so there is
 * no path here that fails quietly.
 */

export type TranscriptionResult =
  | { ok: true; text: string }
  | { ok: false; message: string };

export interface TranscribeDeps {
  fetch: typeof globalThis.fetch;
  /** Abort signal so a stopped recording does not leave a request running. */
  signal?: AbortSignal;
}

/**
 * Whether dictation should be offered at all.
 *
 * Absent configuration means absent feature: audio is sensitive enough that
 * sending it somewhere is an explicit choice, never a default.
 */
export function isDictationConfigured(config: PiWebSpeechToTextConfig | undefined): config is PiWebSpeechToTextConfig {
  return config !== undefined && config.endpoint.trim() !== "";
}

export async function transcribeAudio(
  audio: Blob,
  config: PiWebSpeechToTextConfig,
  deps: TranscribeDeps,
): Promise<TranscriptionResult> {
  if (!isDictationConfigured(config)) return { ok: false, message: "Dictation is not configured." };
  if (audio.size === 0) return { ok: false, message: "Nothing was recorded." };

  const body = new FormData();
  body.append("file", audio, "speech.webm");
  if (config.model !== undefined && config.model !== "") body.append("model", config.model);
  if (config.language !== undefined && config.language !== "") body.append("language", config.language);

  let response: Response;
  try {
    response = await deps.fetch(config.endpoint, {
      method: "POST",
      body,
      ...(deps.signal === undefined ? {} : { signal: deps.signal }),
    });
  } catch (error) {
    // A configured-but-unreachable service is the common case (laptop asleep,
    // container stopped), so it reads as a service problem rather than a bug.
    return { ok: false, message: `Could not reach the transcription service: ${errorText(error)}` };
  }

  if (!response.ok) {
    return { ok: false, message: `Transcription failed (${String(response.status)}).` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, message: "The transcription service returned a response that could not be read." };
  }

  const text = extractTranscript(payload);
  if (text === undefined) return { ok: false, message: "The transcription service returned no text." };
  const trimmed = text.trim();
  // An empty transcript is not an error, but it is not silence either: the user
  // spoke and got nothing back, and should be told rather than left guessing.
  if (trimmed === "") return { ok: false, message: "No speech was recognised." };
  return { ok: true, text: trimmed };
}

/**
 * Pull the transcript out of the response.
 *
 * Whisper-compatible services answer with `{ text }`; some wrap it, so the
 * common alternatives are accepted rather than forcing the user to run a
 * particular build.
 */
export function extractTranscript(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload;
  const record = asRecord(payload);
  if (record === undefined) return undefined;

  for (const key of ["text", "transcript", "transcription"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }

  const segments = record["segments"];
  if (!Array.isArray(segments)) return undefined;
  const joined = segments
    .map((segment) => asRecord(segment)?.["text"])
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return joined.trim() === "" ? undefined : joined;
}

/** Narrow an unknown to a plain object without asserting a shape onto it. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) result[key] = entry;
  return result;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
