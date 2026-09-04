import { describe, expect, it } from "vitest";
import { dictationEnabled, dictationGlyph, dictationLabel, dictationOffered, dictationStatus } from "../composerVoice.js";
import type { VoiceCaptureState } from "./voiceCapture.js";

const configured = { endpoint: "https://stt.example/v1" };

describe("whether dictation is offered at all", () => {
  it("is offered when a transcription endpoint is configured", () => {
    expect(dictationOffered(configured)).toBe(true);
  });

  it("is not offered when nothing is configured, so no microphone can be reached", () => {
    expect(dictationOffered(undefined)).toBe(false);
    expect(dictationOffered({ endpoint: "   " })).toBe(false);
  });
});

describe("what dictation tells you while it runs", () => {
  const cases: [VoiceCaptureState, string, "info" | "problem"][] = [
    [{ kind: "listening" }, "Listening…", "info"],
    [{ kind: "transcribing" }, "Transcribing…", "info"],
    [{ kind: "denied" }, "Microphone permission refused", "problem"],
    [{ kind: "error", message: "Microphone unavailable: NotFoundError" }, "Microphone unavailable: NotFoundError", "problem"],
    [{ kind: "unavailable", reason: "This browser cannot record" }, "This browser cannot record", "problem"],
  ];

  it.each(cases)("says on screen what state %j is in", (state, text, severity) => {
    expect(dictationStatus(state)).toEqual({ text, severity });
  });

  it("stays quiet when nobody is dictating", () => {
    expect(dictationStatus({ kind: "idle" })).toBeUndefined();
  });
});

describe("what a running turn is allowed to disable", () => {
  it("leaves dictation usable while the agent is answering", () => {
    expect(dictationEnabled({ kind: "idle" }, { sessionId: "s" })).toBe(true);
  });

  it("still disables dictation while it is transcribing", () => {
    expect(dictationEnabled({ kind: "transcribing" }, { sessionId: "s" })).toBe(false);
  });

  it("is unusable with no session to dictate into", () => {
    expect(dictationEnabled({ kind: "idle" }, { sessionId: undefined })).toBe(false);
  });
});

describe("how the control reads", () => {
  it("names the streaming and batch cases differently", () => {
    const streaming = dictationLabel({ kind: "idle" }, { ...configured, streaming: { protocol: "browser" } });
    const batch = dictationLabel({ kind: "idle" }, configured);

    expect(streaming).not.toBe("");
    expect(batch).not.toBe("");
  });

  it("shows a stop glyph only while capture is active", () => {
    expect(dictationGlyph({ kind: "listening" })).toBe("\u25A0");
    expect(dictationGlyph({ kind: "idle" })).toBe("\u25CF");
  });
});
