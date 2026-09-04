import type { ComposerRuntimeContext, ComposerStatusLine } from "@gang-of-beads/pi-web/plugin-api";
import { isVoiceCaptureActive, voiceCaptureLabel, type VoiceCaptureState } from "./lib/voiceCapture.js";
import { isDictationConfigured } from "./lib/speechToText.js";
import { resolveSpeechStreaming } from "./lib/speechStreamProtocols.js";
import type { PiWebSpeechToTextConfig } from "./lib/voiceConfig.js";

/**
 * The pure part of the composer's dictation control.
 *
 * Presentation decisions live here so they can be enumerated in tests without
 * a microphone, a socket, or a rendered component: what the control is called,
 * whether it can be pressed, and what the composer says while dictation runs.
 * The status line exists because every voice state used to be written only
 * into a tooltip, and a phone has no tooltips - pressing the button, speaking,
 * and getting nothing back was indistinguishable from the feature not
 * existing.
 */

export function dictationOffered(config: PiWebSpeechToTextConfig | undefined): boolean {
  return isDictationConfigured(config);
}

export function dictationLabel(state: VoiceCaptureState, config: PiWebSpeechToTextConfig | undefined): string {
  return voiceCaptureLabel(state, { streaming: resolveSpeechStreaming(config?.streaming).kind !== "unavailable" });
}

export function dictationGlyph(state: VoiceCaptureState): string {
  return isVoiceCaptureActive(state) ? "\u25A0" : "\u25CF";
}

/**
 * Transcribing is the only state that disables the control: it is already busy
 * with itself. A turn in flight does not, because dictation only puts text in
 * the composer and sends nothing.
 */
export function dictationEnabled(state: VoiceCaptureState, context: Pick<ComposerRuntimeContext, "sessionId">): boolean {
  return context.sessionId !== undefined && state.kind !== "transcribing";
}

export function dictationStatus(state: VoiceCaptureState): ComposerStatusLine | undefined {
  if (state.kind === "idle") return undefined;
  if (state.kind === "error") return { text: state.message, severity: "problem" };
  if (state.kind === "unavailable") return { text: state.reason, severity: "problem" };
  if (state.kind === "denied") return { text: "Microphone permission refused", severity: "problem" };
  if (state.kind === "transcribing") return { text: "Transcribing…", severity: "info" };
  return { text: "Listening…", severity: "info" };
}


