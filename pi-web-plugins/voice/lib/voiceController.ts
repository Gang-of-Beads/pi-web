import type { PiWebSpeechToTextConfig } from "./voiceConfig.js";
import { chooseDictationRoute, DictationRoute } from "./dictationRoute.js";
import { resolveSpeechStreaming } from "./speechStreamProtocols.js";
import { isDictationConfigured, transcribeAudio, type TranscriptionResult } from "./speechToText.js";
import {
  advanceVoiceCapture,
  DEFAULT_VOICE_CAPTURE_CONFIG,
  isVoiceCaptureActive,
  toggleVoiceCapture,
  type VoiceCaptureConfig,
  type VoiceCaptureState,
} from "./voiceCapture.js";

/**
 * Ties the microphone, the tap/VAD state machine and transcription together.
 *
 * The browser pieces are injected rather than reached for directly, so the
 * sequencing — which is where this can go wrong — is testable without a
 * microphone: releasing the device when capture ends, not transcribing a
 * recording the user abandoned, and never leaving the button stuck in
 * "Listening…" when something fails.
 */

export interface VoiceRecorder {
  /** Begin capturing. Rejects if permission is refused or no device exists. */
  start(onFrame: (level: number, elapsedMs: number) => void): Promise<void>;
  /** Stop capturing and return what was recorded. */
  stop(): Promise<Blob>;
  /** Release the device without producing audio. */
  cancel(): void;
}

/**
 * A browser rejects `fetch` called with any receiver but the window, and
 * storing it on a dependency object turns every call into a method call on
 * that object.
 */
export function transcriberFetch(): typeof globalThis.fetch {
  return globalThis.fetch.bind(globalThis);
}

/** A live transcriber, injected so tests can speak without a microphone. */
export interface LiveDictationSession {
  start: (socketUrl: string) => Promise<void>;
  stop: () => void;
}

export interface VoiceControllerDeps {
  recorder: VoiceRecorder;
  createLiveDictation?: (onText: (text: string) => void, onError: (message: string) => void) => LiveDictationSession;
  transcribe?: typeof transcribeAudio;
  fetch?: typeof globalThis.fetch;
  captureConfig?: VoiceCaptureConfig;
}

export interface VoiceControllerCallbacks {
  /** Called whenever the state changes, so the UI can re-render. */
  onState: (state: VoiceCaptureState) => void;
  /** Called with a finished transcript. The caller inserts it; it is never sent. */
  onTranscript: (text: string) => void;
  /**
   * Called with everything heard so far, repeatedly, while dictation runs.
   *
   * Each report supersedes the last, so a caller must replace the span it owns
   * rather than append. Sharing one callback with onTranscript is what made a
   * cumulative report accumulate on screen.
   */
  onLiveTranscript?: (text: string) => void;
}

export class VoiceController {
  private state: VoiceCaptureState = { kind: "idle" };
  /** Captured when listening starts, for an utterance that ends on its own. */
  private activeConfig: PiWebSpeechToTextConfig | undefined;
  private live: LiveDictationSession | undefined;
  private elapsedMs = 0;

  constructor(
    private readonly deps: VoiceControllerDeps,
    private readonly callbacks: VoiceControllerCallbacks,
  ) {}

  getState(): VoiceCaptureState {
    return this.state;
  }

  /**
   * Handle a tap on the dictation control.
   *
   * Unconfigured installs never reach the microphone: the control should not be
   * shown at all, and this refuses as a second line of defence.
   */
  async toggle(config: PiWebSpeechToTextConfig | undefined): Promise<void> {
    if (!isDictationConfigured(config)) {
      this.setState({ kind: "unavailable", reason: "Dictation is not configured." });
      return;
    }

    const next = toggleVoiceCapture(this.state);
    if (next.kind === "listening" && !isVoiceCaptureActive(this.state)) {
      if (chooseDictationRoute(config) === DictationRoute.live) await this.startLive(config);
      else await this.startListening(config);
      return;
    }
    if (next.kind === "idle") {
      // Abandoned before saying anything: release the device, keep nothing.
      this.closeLive();
      this.deps.recorder.cancel();
      this.setState({ kind: "idle" });
      return;
    }
    if (next.kind === "transcribing") {
      // Live text is already in the composer, so stopping is the whole ending.
      if (this.live !== undefined) {
        this.closeLive();
        this.setState({ kind: "idle" });
        return;
      }
      await this.finish(config);
      return;
    }
    this.setState(next);
  }

  private closeLive(): void {
    const live = this.live;
    if (live === undefined) return;
    this.live = undefined;
    live.stop();
  }

  private async startLive(config: PiWebSpeechToTextConfig): Promise<void> {
    const streaming = resolveSpeechStreaming(config.streaming, config.language);
    const create = this.deps.createLiveDictation;
    if (streaming.kind !== "socket" || create === undefined) {
      await this.startListening(config);
      return;
    }

    this.activeConfig = config;
    this.elapsedMs = 0;
    this.setState({ kind: "listening" });
    this.live = create(
      (text) => { (this.callbacks.onLiveTranscript ?? this.callbacks.onTranscript)(text); },
      (message) => { this.setState({ kind: "error", message }); },
    );
    try {
      await this.live.start(streaming.url);
    } catch (error) {
      this.live = undefined;
      this.setState({ kind: "error", message: `Live transcription failed: ${errorText(error)}` });
    }
  }

  private async startListening(config: PiWebSpeechToTextConfig): Promise<void> {
    this.activeConfig = config;
    this.elapsedMs = 0;
    this.setState({ kind: "listening" });
    try {
      await this.deps.recorder.start((level, frameMs) => { this.onFrame(level, frameMs); });
    } catch (error) {
      // Permission is the common refusal and deserves its own wording; anything
      // else still surfaces rather than leaving the button mid-flight.
      this.setState(isPermissionError(error)
        ? { kind: "denied" }
        : { kind: "error", message: `Microphone unavailable: ${errorText(error)}` });
    }
  }

  /** Fed by the recorder; drives the VAD rules. */
  private onFrame(level: number, frameMs: number): void {
    if (!isVoiceCaptureActive(this.state)) return;
    this.elapsedMs += frameMs;
    const next = advanceVoiceCapture(
      this.state,
      { level, elapsedMs: frameMs },
      this.elapsedMs,
      this.deps.captureConfig ?? DEFAULT_VOICE_CAPTURE_CONFIG,
    );
    if (next === this.state) return;

    if (next.kind === "transcribing") {
      // Speech ended on its own; the config was checked when capture started.
      void this.finish(this.activeConfig);
      return;
    }
    if (next.kind === "idle") {
      this.deps.recorder.cancel();
    }
    this.setState(next);
  }

  private async finish(config: PiWebSpeechToTextConfig | undefined): Promise<void> {
    this.setState({ kind: "transcribing" });
    let audio: Blob;
    try {
      audio = await this.deps.recorder.stop();
    } catch (error) {
      this.setState({ kind: "error", message: `Recording failed: ${errorText(error)}` });
      return;
    }
    if (!isDictationConfigured(config)) {
      this.setState({ kind: "unavailable", reason: "Dictation is not configured." });
      return;
    }

    const transcribe = this.deps.transcribe ?? transcribeAudio;
    const result: TranscriptionResult = await transcribe(audio, config, { fetch: this.deps.fetch ?? transcriberFetch() });
    if (!result.ok) {
      this.setState({ kind: "error", message: result.message });
      return;
    }
    // The caller decides what to do with the text. It is never auto-sent: the
    // user should read what was heard before it goes anywhere.
    this.callbacks.onTranscript(result.text);
    this.setState({ kind: "idle" });
  }

  private setState(state: VoiceCaptureState): void {
    this.state = state;
    this.callbacks.onState(state);
  }
}

function isPermissionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error ? error.name : undefined;
  return name === "NotAllowedError" || name === "SecurityError";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
