// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { PiWebSpeechToTextConfig } from "../../shared/apiTypes";
import { extractTranscript, isDictationConfigured, transcribeAudio } from "./speechToText";

const config: PiWebSpeechToTextConfig = { endpoint: "http://127.0.0.1:9000/v1/audio/transcriptions" };
const audio = new Blob(["fake-audio"], { type: "audio/webm" });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("isDictationConfigured", () => {
  it("treats missing or blank configuration as opted out", () => {
    // Audio is sensitive; sending it anywhere must be a deliberate choice.
    expect(isDictationConfigured(undefined)).toBe(false);
    expect(isDictationConfigured({ endpoint: "   " })).toBe(false);
  });

  it("recognises a configured endpoint", () => {
    expect(isDictationConfigured(config)).toBe(true);
  });
});

describe("transcribeAudio", () => {
  it("returns the transcript on success", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({ text: "  hello there  " })));
    await expect(transcribeAudio(audio, config, { fetch })).resolves.toEqual({ ok: true, text: "hello there" });
  });

  it("sends the audio with the optional hints when configured", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({ text: "ok" })));
    await transcribeAudio(audio, { ...config, model: "whisper-1", language: "en" }, { fetch });

    const body = sentForm(fetch);
    expect(body.get("model")).toBe("whisper-1");
    expect(body.get("language")).toBe("en");
    expect(body.get("file")).toBeInstanceOf(Blob);
  });

  it("omits hints that were not configured", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({ text: "ok" })));
    await transcribeAudio(audio, config, { fetch });

    const body = sentForm(fetch);
    expect(body.get("model")).toBeNull();
    expect(body.get("language")).toBeNull();
  });

  it("reports an unreachable service as a service problem", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("connect ECONNREFUSED")));
    const result = await transcribeAudio(audio, config, { fetch });

    // The usual cause is a stopped container, not a bug in the app.
    expect(result).toEqual({ ok: false, message: "Could not reach the transcription service: connect ECONNREFUSED" });
  });

  it("reports a failing status", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({}, 503)));
    await expect(transcribeAudio(audio, config, { fetch })).resolves.toEqual({ ok: false, message: "Transcription failed (503)." });
  });

  it("reports an unreadable response", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("not json", { status: 200 })));
    const result = await transcribeAudio(audio, config, { fetch });
    expect(result.ok).toBe(false);
  });

  it("tells the user when nothing was recognised rather than inserting nothing", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({ text: "   " })));
    await expect(transcribeAudio(audio, config, { fetch })).resolves.toEqual({ ok: false, message: "No speech was recognised." });
  });

  it("refuses an empty recording without calling the service", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({ text: "x" })));
    const result = await transcribeAudio(new Blob([]), config, { fetch });

    expect(result).toEqual({ ok: false, message: "Nothing was recorded." });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses to send anything when dictation is unconfigured", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({ text: "x" })));
    await transcribeAudio(audio, { endpoint: "" }, { fetch });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("extractTranscript", () => {
  it("accepts the shapes transcription services actually return", () => {
    expect(extractTranscript({ text: "a" })).toBe("a");
    expect(extractTranscript({ transcript: "b" })).toBe("b");
    expect(extractTranscript({ transcription: "c" })).toBe("c");
    expect(extractTranscript("d")).toBe("d");
  });

  it("joins segmented output", () => {
    expect(extractTranscript({ segments: [{ text: "one" }, { text: "two" }] })).toBe("one two");
  });

  it("returns nothing when there is no text to find", () => {
    expect(extractTranscript({ unrelated: 1 })).toBeUndefined();
    expect(extractTranscript(null)).toBeUndefined();
    expect(extractTranscript({ segments: [] })).toBeUndefined();
  });
});


/** The FormData the client posted, or a clear failure if it posted nothing. */
function sentForm(fetch: ReturnType<typeof vi.fn>): FormData {
  const init: unknown = fetch.mock.calls[0]?.[1];
  const body: unknown = init !== null && typeof init === "object" && "body" in init ? init.body : undefined;
  if (!(body instanceof FormData)) throw new Error("Expected the audio to be posted as FormData");
  return body;
}
