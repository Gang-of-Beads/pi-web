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
  it("refuses the browser's own recogniser because this version streams only to Azure Speech", () => {
    expect(resolveSpeechStreaming({ protocol: "browser" }))
      .toEqual({ kind: "unavailable", reason: "This version streams only to Azure Speech." });
  });

  it("uses the Azure Speech socket once it has a url; the token comes from the plugin's server half", () => {
    expect(resolveSpeechStreaming({
      protocol: "azure-speech",
      url: "wss://swedencentral.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1",
    })).toEqual({
      kind: "socket",
      protocol: "azure-speech",
      url: "wss://swedencentral.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1",
      deltaMode: "replace",
    });
  });

  it("refuses a socket protocol with no url", () => {
    expect(resolveSpeechStreaming({ protocol: "azure-speech" }))
      .toEqual({ kind: "unavailable", reason: "Streaming transcription needs a socket url." });
  });

  it("refuses a protocol this version has no socket client for", () => {
    expect(resolveSpeechStreaming({ protocol: "openai-realtime", url: "wss://api.openai.com/v1/realtime" }))
      .toEqual({ kind: "unavailable", reason: "This version streams only to Azure Speech." });
  });

  it("has nothing to do when streaming was never configured", () => {
    expect(resolveSpeechStreaming(undefined)).toEqual({ kind: "unavailable", reason: "Live transcription is not configured." });
  });
});

describe("azure speech", () => {
  /**
   * Azure's socket speaks a different vocabulary again: a hypothesis while the
   * phrase is still forming, and a recognised result once it settles. Its
   * hypotheses re-send the whole phrase, so they replace rather than append.
   */
  it("reads a hypothesis as a replaceable guess", () => {
    expect(decodeSpeechStreamEvent("azure-speech", {
      Type: "speech.hypothesis",
      Text: "hello",
    })).toEqual({ kind: "delta", text: "hello" });
  });

  it("reads a recognised phrase as settled", () => {
    expect(decodeSpeechStreamEvent("azure-speech", {
      Type: "speech.phrase",
      RecognitionStatus: "Success",
      DisplayText: "hello there",
    })).toEqual({ kind: "final", text: "hello there" });
  });

  it("ignores a phrase that recognised nothing rather than clearing the text", () => {
    // NoMatch arrives on silence between phrases; treating it as an empty
    // final would wipe what had already been dictated.
    expect(decodeSpeechStreamEvent("azure-speech", {
      Type: "speech.phrase",
      RecognitionStatus: "NoMatch",
      DisplayText: "",
    })).toBeUndefined();
  });

  it("reports a turn that ended in an error", () => {
    expect(decodeSpeechStreamEvent("azure-speech", {
      Type: "speech.phrase",
      RecognitionStatus: "Error",
      DisplayText: "",
    })).toEqual({ kind: "error", message: "Speech recognition reported an error." });
  });
});
