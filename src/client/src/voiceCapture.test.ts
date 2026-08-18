import { describe, expect, it } from "vitest";
import {
  advanceVoiceCapture,
  DEFAULT_VOICE_CAPTURE_CONFIG,
  isVoiceCaptureActive,
  toggleVoiceCapture,
  voiceCaptureLabel,
  type VoiceCaptureState,
} from "./voiceCapture";

const LOUD = { level: 0.5, elapsedMs: 100 };
const QUIET = { level: 0.001, elapsedMs: 100 };

/** Feed frames in sequence, as the audio callback would. */
function run(state: VoiceCaptureState, frames: { level: number; elapsedMs: number }[]): VoiceCaptureState {
  let total = 0;
  let current = state;
  for (const frame of frames) {
    total += frame.elapsedMs;
    current = advanceVoiceCapture(current, frame, total);
  }
  return current;
}

describe("advanceVoiceCapture", () => {
  it("keeps listening through silence before anyone speaks", () => {
    // The whole point of tap-to-talk: thinking time must not end the recording.
    const after = run({ kind: "listening" }, Array.from({ length: 100 }, () => QUIET));
    expect(after).toEqual({ kind: "listening" });
  });

  it("starts the utterance when speech is detected", () => {
    expect(run({ kind: "listening" }, [QUIET, LOUD])).toEqual({ kind: "speaking" });
  });

  it("survives a pause mid-sentence", () => {
    // 300ms of silence is a breath, not the end of a thought.
    const after = run({ kind: "speaking" }, [QUIET, QUIET, QUIET, LOUD]);
    expect(after).toEqual({ kind: "speaking" });
  });

  it("finishes the utterance once speech has stopped for long enough", () => {
    const frames = [LOUD, ...Array.from({ length: 9 }, () => QUIET)];
    expect(run({ kind: "listening" }, frames)).toEqual({ kind: "transcribing" });
  });

  it("does not finish a moment too early", () => {
    // 800ms of trailing silence, just under the 900ms threshold.
    const frames = [LOUD, ...Array.from({ length: 8 }, () => QUIET)];
    expect(run({ kind: "listening" }, frames).kind).toBe("trailing");
  });

  it("ends a runaway recording rather than holding the microphone forever", () => {
    const long = { level: 0.5, elapsedMs: DEFAULT_VOICE_CAPTURE_CONFIG.maxUtteranceMs };
    expect(advanceVoiceCapture({ kind: "speaking" }, long, long.elapsedMs)).toEqual({ kind: "transcribing" });
  });

  it("drops a runaway that never heard speech instead of transcribing silence", () => {
    const long = { level: 0.001, elapsedMs: DEFAULT_VOICE_CAPTURE_CONFIG.maxUtteranceMs };
    expect(advanceVoiceCapture({ kind: "listening" }, long, long.elapsedMs)).toEqual({ kind: "idle" });
  });

  it("ignores frames once capture has left the listening states", () => {
    const settled: VoiceCaptureState[] = [{ kind: "idle" }, { kind: "transcribing" }, { kind: "denied" }];
    for (const state of settled) {
      expect(advanceVoiceCapture(state, LOUD, 100)).toEqual(state);
    }
  });
});

describe("toggleVoiceCapture", () => {
  it("starts from idle and from a recoverable failure", () => {
    expect(toggleVoiceCapture({ kind: "idle" })).toEqual({ kind: "listening" });
    expect(toggleVoiceCapture({ kind: "denied" })).toEqual({ kind: "listening" });
    expect(toggleVoiceCapture({ kind: "error", message: "x" })).toEqual({ kind: "listening" });
  });

  it("discards a recording that captured nothing", () => {
    expect(toggleVoiceCapture({ kind: "listening" })).toEqual({ kind: "idle" });
  });

  it("keeps what was said when stopped mid-utterance", () => {
    expect(toggleVoiceCapture({ kind: "speaking" })).toEqual({ kind: "transcribing" });
    expect(toggleVoiceCapture({ kind: "trailing", silenceMs: 200 })).toEqual({ kind: "transcribing" });
  });

  it("does nothing while transcribing or unavailable", () => {
    expect(toggleVoiceCapture({ kind: "transcribing" })).toEqual({ kind: "transcribing" });
    const off = { kind: "unavailable", reason: "Not configured" } as const;
    expect(toggleVoiceCapture(off)).toEqual(off);
  });
});

describe("state reporting", () => {
  it("knows when the microphone is held", () => {
    expect(isVoiceCaptureActive({ kind: "speaking" })).toBe(true);
    expect(isVoiceCaptureActive({ kind: "idle" })).toBe(false);
    expect(isVoiceCaptureActive({ kind: "transcribing" })).toBe(false);
  });

  it("says something for every state, so nothing fails silently", () => {
    const states: VoiceCaptureState[] = [
      { kind: "idle" }, { kind: "listening" }, { kind: "speaking" },
      { kind: "trailing", silenceMs: 0 }, { kind: "transcribing" },
      { kind: "denied" }, { kind: "unavailable", reason: "Dictation is not configured" },
      { kind: "error", message: "Transcription failed" },
    ];
    for (const state of states) expect(voiceCaptureLabel(state)).not.toBe("");
  });
});
