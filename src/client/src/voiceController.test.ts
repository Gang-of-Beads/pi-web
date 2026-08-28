// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { PiWebSpeechToTextConfig } from "../../shared/apiTypes";
import type { VoiceCaptureState } from "./voiceCapture";
import { VoiceController, type VoiceRecorder } from "./voiceController";

const config: PiWebSpeechToTextConfig = { endpoint: "http://127.0.0.1:9000/transcribe" };

function harness(options: {
  transcript?: string;
  transcribeError?: string;
  startError?: Error;
  stopError?: Error;
} = {}) {
  const states: VoiceCaptureState[] = [];
  const transcripts: string[] = [];
  let emit: ((level: number, elapsedMs: number) => void) | undefined;
  const cancel = vi.fn();
  const stop = vi.fn(() => options.stopError !== undefined
    ? Promise.reject(options.stopError)
    : Promise.resolve(new Blob(["audio"])));

  const recorder: VoiceRecorder = {
    start: (onFrame) => {
      if (options.startError !== undefined) return Promise.reject(options.startError);
      emit = onFrame;
      return Promise.resolve();
    },
    stop,
    cancel,
  };

  const controller = new VoiceController(
    {
      recorder,
      transcribe: () => Promise.resolve(options.transcribeError !== undefined
        ? { ok: false as const, message: options.transcribeError }
        : { ok: true as const, text: options.transcript ?? "hello" }),
    },
    { onState: (state) => states.push(state), onTranscript: (text) => transcripts.push(text) },
  );
  return { controller, states, transcripts, cancel, stop, frame: (level: number, ms = 100) => emit?.(level, ms) };
}

describe("VoiceController", () => {
  it("refuses to touch the microphone when dictation is unconfigured", async () => {
    const h = harness();
    await h.controller.toggle(undefined);

    expect(h.controller.getState()).toEqual({ kind: "unavailable", reason: "Dictation is not configured." });
    expect(h.stop).not.toHaveBeenCalled();
  });

  it("starts listening on the first tap", async () => {
    const h = harness();
    await h.controller.toggle(config);
    expect(h.controller.getState()).toEqual({ kind: "listening" });
  });

  it("transcribes once speech starts and stops", async () => {
    const h = harness({ transcript: "hello there" });
    await h.controller.toggle(config);

    h.frame(0.5);
    for (let i = 0; i < 10; i += 1) h.frame(0.001);
    await vi.waitFor(() => { expect(h.transcripts).toEqual(["hello there"]); });

    expect(h.controller.getState()).toEqual({ kind: "idle" });
  });

  it("hands the text to the caller rather than sending it", async () => {
    const h = harness({ transcript: "draft this" });
    await h.controller.toggle(config);
    h.frame(0.5);
    for (let i = 0; i < 10; i += 1) h.frame(0.001);

    await vi.waitFor(() => { expect(h.transcripts).toEqual(["draft this"]); });
  });

  it("releases the device when the user taps away before speaking", async () => {
    const h = harness();
    await h.controller.toggle(config);
    await h.controller.toggle(config);

    expect(h.cancel).toHaveBeenCalled();
    expect(h.controller.getState()).toEqual({ kind: "idle" });
    expect(h.stop).not.toHaveBeenCalled();
  });

  it("keeps what was said when stopped mid-utterance", async () => {
    const h = harness({ transcript: "partial thought" });
    await h.controller.toggle(config);
    h.frame(0.5);
    await h.controller.toggle(config);

    await vi.waitFor(() => { expect(h.transcripts).toEqual(["partial thought"]); });
  });

  it("reports a denied microphone distinctly", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const h = harness({ startError: denied });
    await h.controller.toggle(config);

    expect(h.controller.getState()).toEqual({ kind: "denied" });
  });

  it("surfaces any other microphone failure instead of hanging on listening", async () => {
    const h = harness({ startError: new Error("no device") });
    await h.controller.toggle(config);

    expect(h.controller.getState()).toMatchObject({ kind: "error" });
  });

  it("surfaces a transcription failure", async () => {
    const h = harness({ transcribeError: "Transcription failed (503)." });
    await h.controller.toggle(config);
    h.frame(0.5);
    for (let i = 0; i < 10; i += 1) h.frame(0.001);

    await vi.waitFor(() => {
      expect(h.controller.getState()).toEqual({ kind: "error", message: "Transcription failed (503)." });
    });
  });

  it("surfaces a recording failure", async () => {
    const h = harness({ stopError: new Error("stream closed") });
    await h.controller.toggle(config);
    h.frame(0.5);
    await h.controller.toggle(config);

    await vi.waitFor(() => { expect(h.controller.getState()).toMatchObject({ kind: "error" }); });
  });

  it("ignores frames once capture has ended", async () => {
    const h = harness();
    await h.controller.toggle(config);
    await h.controller.toggle(config);
    const before = h.states.length;

    h.frame(0.9);

    expect(h.states.length).toBe(before);
  });
});

describe("speaking into a deployment that can stream", () => {
  /**
   * A speaker who pauses, resumes, or changes language wants to see the
   * sentence forming. The whole-clip path shows nothing until they stop, and
   * every streaming part existed but nothing reached it.
   */
  it("delivers words while the speaker is still talking", async () => {
    const streamed: string[] = [];
    let seenStates = 0;
    let feedText: ((text: string) => void) | undefined;
    let stopped = false;
    const live = {
      start: () => Promise.resolve(),
      stop: () => { stopped = true; },
    };

    const controller = new VoiceController(
      { recorder: silentRecorder(), createLiveDictation: (onText) => { feedText = onText; return live; } },
      { onState: () => { seenStates += 1; }, onTranscript: (text) => { streamed.push(text); } },
    );

    await controller.toggle({
      endpoint: "https://example.test/speech",
      streaming: { protocol: "azure-speech", url: "wss://example.test/stream", tokenEndpoint: "api/speech/token" },
    });
    feedText?.("你好");
    feedText?.("你好，世界");

    expect(streamed).toEqual(["你好", "你好，世界"]);
    expect(seenStates).toBeGreaterThan(0);
    expect(stopped).toBe(false);
  });
});

function silentRecorder(): VoiceRecorder {
  return {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(new Blob(["audio"])),
    cancel: () => { /* nothing is held when the microphone never opened */ },
  };
}
