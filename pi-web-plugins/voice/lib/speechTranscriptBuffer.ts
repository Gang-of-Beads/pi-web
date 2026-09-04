import type { SpeechStreamEvent, SpeechStreamProtocol } from "./speechStreamProtocols";

/**
 * How a service's deltas combine into the text on screen.
 *
 * OpenAI sends fragments to append; Deepgram re-sends the whole current phrase
 * each time. Appending Deepgram's interim results produces "hello hello there
 * hello there now", and replacing on OpenAI's leaves only the last syllable.
 */
export type SpeechDeltaMode = "append" | "replace";

export const SPEECH_DELTA_MODES: Record<SpeechStreamProtocol, SpeechDeltaMode> = {
  "openai-realtime": "append",
  deepgram: "replace",
  // Azure re-sends the whole phrase in each hypothesis, like Deepgram.
  "azure-speech": "replace",
};

/**
 * The text a dictating user sees, kept in two parts.
 *
 * Settled text is what the service has committed to. The pending guess is
 * replaced on every message and may vanish entirely, so it is never mixed into
 * the settled half: stopping mid-phrase should keep what was actually heard
 * rather than a half-formed guess that happened to be on screen.
 */
export class SpeechTranscriptBuffer {
  private settled = "";
  private pending = "";
  private readonly mode: SpeechDeltaMode;

  constructor(mode: SpeechDeltaMode) {
    this.mode = mode;
  }

  apply(event: SpeechStreamEvent): void {
    if (event.kind === "delta") {
      this.pending = this.mode === "append" ? this.pending + event.text : event.text;
      return;
    }
    if (event.kind === "final") {
      this.settled = this.settled === "" ? event.text : `${this.settled} ${event.text}`;
      this.pending = "";
      return;
    }
    // An error leaves the text alone: what was already heard is still true, and
    // discarding it would lose words the user cannot get back.
  }

  /**
   * Everything on screen: settled text, then the guess still forming.
   *
   * An appending service sends its own leading spaces, so joining with another
   * one produces a double space mid-sentence.
   */
  text(): string {
    if (this.pending === "") return this.settled;
    if (this.settled === "") return this.pending;
    return /^\s/u.test(this.pending) ? this.settled + this.pending : `${this.settled} ${this.pending}`;
  }

  /** Only what the service committed to. */
  settledText(): string {
    return this.settled;
  }
}
