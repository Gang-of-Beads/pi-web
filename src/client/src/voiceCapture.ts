/**
 * Tap-to-talk capture state.
 *
 * The interaction the user asked for: one tap starts listening, one tap stops.
 * While listening, silence is not a reason to stop — someone gathering their
 * thoughts before speaking must not have the recording cut from under them.
 * Speech is detected, and the utterance ends when speech *stops*, not when the
 * user happens to pause mid-sentence.
 *
 * This is the part worth isolating: the microphone, the encoder and the
 * transcription service are all replaceable, but getting the state machine
 * wrong means either cutting people off or recording forever.
 */

export type VoiceCaptureState =
  /** Not listening. The default, and where an unconfigured install stays. */
  | { kind: "idle" }
  /** Listening, nothing heard yet. Stays here indefinitely. */
  | { kind: "listening" }
  /** Speech in progress. */
  | { kind: "speaking" }
  /** Speech stopped; waiting to see whether it resumes before transcribing. */
  | { kind: "trailing"; silenceMs: number }
  /** Audio captured and handed to transcription. */
  | { kind: "transcribing" }
  /** Terminal states the UI must surface rather than fail silently. */
  | { kind: "denied" }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };

export interface VoiceCaptureConfig {
  /** Silence after speech before the utterance is considered finished. */
  trailingSilenceMs: number;
  /** Loudness above which a frame counts as speech, 0..1. */
  speechThreshold: number;
  /** Hard cap so a stuck microphone cannot record without end. */
  maxUtteranceMs: number;
}

export const DEFAULT_VOICE_CAPTURE_CONFIG: VoiceCaptureConfig = {
  // Long enough to survive a breath between clauses, short enough that the
  // transcript does not lag the speaker.
  trailingSilenceMs: 900,
  speechThreshold: 0.02,
  maxUtteranceMs: 120_000,
};

export interface VoiceFrame {
  /** Frame loudness, 0..1. */
  level: number;
  /** Milliseconds since the previous frame. */
  elapsedMs: number;
}

/**
 * Advance the state machine by one audio frame.
 *
 * Pure, so the timing rules can be tested without a microphone: the awkward
 * cases are silence before speech (must wait), a pause mid-sentence (must not
 * end the utterance), and a runaway recording (must end).
 */
export function advanceVoiceCapture(
  state: VoiceCaptureState,
  frame: VoiceFrame,
  elapsedTotalMs: number,
  config: VoiceCaptureConfig = DEFAULT_VOICE_CAPTURE_CONFIG,
): VoiceCaptureState {
  if (state.kind !== "listening" && state.kind !== "speaking" && state.kind !== "trailing") return state;

  // A recording that never ends is worse than one cut short.
  if (elapsedTotalMs >= config.maxUtteranceMs) {
    return state.kind === "listening" ? { kind: "idle" } : { kind: "transcribing" };
  }

  const isSpeech = frame.level >= config.speechThreshold;

  if (state.kind === "listening") {
    // Silence here is the user deciding what to say; keep waiting.
    return isSpeech ? { kind: "speaking" } : state;
  }

  if (state.kind === "speaking") {
    return isSpeech ? state : { kind: "trailing", silenceMs: frame.elapsedMs };
  }

  // trailing
  if (isSpeech) return { kind: "speaking" };
  const silenceMs = state.silenceMs + frame.elapsedMs;
  return silenceMs >= config.trailingSilenceMs ? { kind: "transcribing" } : { kind: "trailing", silenceMs };
}

/** Whether a tap should start or stop capture. */
export function toggleVoiceCapture(state: VoiceCaptureState): VoiceCaptureState {
  switch (state.kind) {
    case "idle":
    case "denied":
    case "error":
      return { kind: "listening" };
    case "listening":
      // Stopped before saying anything: nothing to transcribe.
      return { kind: "idle" };
    case "speaking":
    case "trailing":
      // Stopping mid-utterance keeps what was said rather than discarding it.
      return { kind: "transcribing" };
    case "transcribing":
    case "unavailable":
      return state;
  }
}

/** Whether capture is currently holding the microphone. */
export function isVoiceCaptureActive(state: VoiceCaptureState): boolean {
  return state.kind === "listening" || state.kind === "speaking" || state.kind === "trailing";
}

/**
 * What to tell the user. Every non-idle state says something: a microphone that
 * silently does nothing is the worst version of this feature.
 */
/**
 * @param options.streaming Whether live transcription is configured. The two
 * modes behave differently enough that a user should know which one they are
 * speaking into - batch dictation says nothing until it is stopped, live
 * dictation writes as it hears - and this label is the only thing that says so
 * before they start talking. Once capture is under way the mode no longer
 * matters, so the running states read the same either way.
 */
export function voiceCaptureLabel(state: VoiceCaptureState, options?: { streaming?: boolean }): string {
  switch (state.kind) {
    case "idle": return options?.streaming === true ? "Dictate live" : "Dictate";
    case "listening": return "Listening…";
    case "speaking": return "Listening…";
    case "trailing": return "Listening…";
    case "transcribing": return "Transcribing…";
    case "denied": return "Microphone permission denied";
    case "unavailable": return state.reason;
    case "error": return state.message;
  }
}
