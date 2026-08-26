import { describe, expect, it } from "vitest";
import { decodeSpeechStreamEvent, resolveSpeechStreaming } from "./speechStreamProtocols";

/**
 * Each streaming transcription service speaks its own protocol. What the
 * composer needs from all of them is the same three things: text that replaces
 * the current guess, text that is settled, and a failure worth showing.
 *
 * Decoding is pure so a protocol can be verified against its documented
 * message shapes without a microphone, a socket, or an account.
 */
describe("openai realtime", () => {
  it("reads an incremental delta", () => {
    expect(decodeSpeechStreamEvent("openai-realtime", {
      type: "conversation.item.input_audio_transcription.delta",
      delta: "hello",
      item_id: "i1",
    })).toEqual({ kind: "delta", text: "hello" });
  });

  it("reads the settled transcript", () => {
    expect(decodeSpeechStreamEvent("openai-realtime", {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "hello there",
      item_id: "i1",
    })).toEqual({ kind: "final", text: "hello there" });
  });

  it("surfaces an error the service reports", () => {
    expect(decodeSpeechStreamEvent("openai-realtime", {
      type: "error",
      error: { message: "audio buffer too small" },
    })).toEqual({ kind: "error", message: "audio buffer too small" });
  });

  it("ignores the events it has nothing to say about", () => {
    expect(decodeSpeechStreamEvent("openai-realtime", { type: "session.created" })).toBeUndefined();
  });
});

describe("deepgram", () => {
  it("reads an interim result as a replaceable guess", () => {
    expect(decodeSpeechStreamEvent("deepgram", {
      type: "Results",
      is_final: false,
      channel: { alternatives: [{ transcript: "hello" }] },
    })).toEqual({ kind: "delta", text: "hello" });
  });

  it("reads a final result as settled text", () => {
    expect(decodeSpeechStreamEvent("deepgram", {
      type: "Results",
      is_final: true,
      channel: { alternatives: [{ transcript: "hello there" }] },
    })).toEqual({ kind: "final", text: "hello there" });
  });

  it("drops an empty alternative rather than clearing what was heard", () => {
    // Deepgram emits empty interim results between phrases; treating them as
    // text would blank the composer mid-sentence.
    expect(decodeSpeechStreamEvent("deepgram", {
      type: "Results",
      is_final: false,
      channel: { alternatives: [{ transcript: "" }] },
    })).toBeUndefined();
  });
});

describe("anything unrecognised", () => {
  it("is ignored rather than guessed at", () => {
    expect(decodeSpeechStreamEvent("openai-realtime", "not an object")).toBeUndefined();
    expect(decodeSpeechStreamEvent("deepgram", null)).toBeUndefined();
    expect(decodeSpeechStreamEvent("openai-realtime", {})).toBeUndefined();
  });
});

describe("choosing how to stream", () => {
  /**
   * A misconfigured socket protocol must not fall back to something else
   * without saying so: silently dictating into a different service than the
   * one an install chose is worse than not dictating at all.
   */
  it("uses the browser's own recogniser when that is what was chosen", () => {
    expect(resolveSpeechStreaming({ protocol: "browser" })).toEqual({ kind: "browser" });
  });

  it("uses a socket protocol once it has a url and somewhere to get a credential", () => {
    expect(resolveSpeechStreaming({
      protocol: "deepgram",
      url: "wss://api.deepgram.com/v1/listen",
      tokenEndpoint: "api/speech/token",
    })).toEqual({
      kind: "socket",
      protocol: "deepgram",
      url: "wss://api.deepgram.com/v1/listen",
      tokenEndpoint: "api/speech/token",
      deltaMode: "replace",
    });
  });

  it("refuses a socket protocol with no url", () => {
    expect(resolveSpeechStreaming({ protocol: "deepgram", tokenEndpoint: "api/speech/token" }))
      .toEqual({ kind: "unavailable", reason: "Streaming transcription needs a socket url." });
  });

  it("refuses to put an account key in the browser", () => {
    // No token endpoint means the only way to authenticate would be to ship a
    // long-lived key to the page.
    expect(resolveSpeechStreaming({ protocol: "openai-realtime", url: "wss://api.openai.com/v1/realtime" }))
      .toEqual({ kind: "unavailable", reason: "Streaming transcription needs a token endpoint so the account key stays on the server." });
  });

  it("has nothing to do when streaming was never configured", () => {
    expect(resolveSpeechStreaming(undefined)).toEqual({ kind: "unavailable", reason: "Live transcription is not configured." });
  });
});
