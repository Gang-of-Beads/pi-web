import { decodeAzureFrame, encodeAzureTextFrame } from "./azureSpeechFrames";
import { decodeSpeechStreamEvent, type SpeechStreamProtocol } from "./speechStreamProtocols";
import { SpeechTranscriptBuffer, SPEECH_DELTA_MODES } from "./speechTranscriptBuffer";
import { downsampleTo, encodePcm16Base64, floatToPcm16 } from "./pcmAudio";

/**
 * One live dictation: token, socket, microphone, and the text they produce.
 *
 * The audio goes from the page straight to the service, because putting a
 * relay in the path would add a hop to every syllable for nothing. What the
 * page does not hold is the account key: it asks this server for a ten-minute
 * token first, so the credential it carries expires on its own.
 *
 * Everything the protocols disagree about - framing, event names, whether a
 * delta appends or replaces - is already decided elsewhere. This only sequences
 * them.
 */
export interface LiveDictationDeps {
  /** Fetches a short-lived credential. Resolves to the token and its region. */
  requestToken: () => Promise<{ token: string; region: string }>;
  openSocket: (url: string) => WebSocket;
  /** Starts the microphone; resolves with a stop function. */
  captureAudio: (onSamples: (samples: Float32Array, sampleRate: number) => void) => Promise<() => void>;
  onText: (text: string) => void;
  onError: (message: string) => void;
  newRequestId: () => string;
}

/** The sample rate Azure's conversation endpoint expects. */
export const AZURE_SAMPLE_RATE = 16_000;

export class LiveDictation {
  private readonly deps: LiveDictationDeps;
  private readonly protocol: SpeechStreamProtocol;
  private socket: WebSocket | undefined;
  private stopCapture: (() => void) | undefined;
  private buffer: SpeechTranscriptBuffer;
  private requestId = "";

  constructor(deps: LiveDictationDeps, protocol: SpeechStreamProtocol = "azure-speech") {
    this.deps = deps;
    this.protocol = protocol;
    this.buffer = new SpeechTranscriptBuffer(SPEECH_DELTA_MODES[protocol]);
  }

  async start(socketUrl: string): Promise<void> {
    this.buffer = new SpeechTranscriptBuffer(SPEECH_DELTA_MODES[this.protocol]);
    let credential: { token: string; region: string };
    try {
      credential = await this.deps.requestToken();
    } catch (error) {
      this.deps.onError(`Could not get a dictation token: ${messageOf(error)}`);
      return;
    }

    this.requestId = this.deps.newRequestId();
    const url = new URL(socketUrl);
    // The token travels in the query string because a browser cannot set
    // headers on a WebSocket handshake.
    url.searchParams.set("Authorization", `Bearer ${credential.token}`);
    url.searchParams.set("X-ConnectionId", this.requestId);

    const socket = this.deps.openSocket(url.toString());
    this.socket = socket;
    socket.onmessage = (event: MessageEvent<unknown>) => { this.receive(event.data); };
    socket.onerror = () => { this.deps.onError("The dictation connection failed."); };
    socket.onopen = () => {
      socket.send(encodeAzureTextFrame("speech.config", this.requestId, {
        context: { system: { name: "pi-web" } },
      }));
      void this.beginCapture(socket);
    };
  }

  stop(): void {
    this.stopCapture?.();
    this.stopCapture = undefined;
    this.socket?.close();
    this.socket = undefined;
    // Only settled text survives a stop: a half-formed guess that happened to
    // be on screen is not something the speaker said.
    const settled = this.buffer.settledText();
    if (settled !== "") this.deps.onText(settled);
  }

  private async beginCapture(socket: WebSocket): Promise<void> {
    try {
      this.stopCapture = await this.deps.captureAudio((samples, sampleRate) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const resampled = downsampleTo(samples, sampleRate, AZURE_SAMPLE_RATE);
        socket.send(encodeAzureTextFrame("audio", this.requestId, {
          audio: encodePcm16Base64(floatToPcm16(resampled)),
        }));
      });
    } catch (error) {
      this.deps.onError(`Could not use the microphone: ${messageOf(error)}`);
      this.stop();
    }
  }

  private receive(data: unknown): void {
    if (typeof data !== "string") return;
    const frame = decodeAzureFrame(data);
    if (frame?.body === undefined) return;
    // The frame's path is what the decoder keys on, so it is put back in the
    // shape the protocol decoder expects rather than decoded twice.
    const event = decodeSpeechStreamEvent(this.protocol, { ...frame.body, Type: frame.path });
    if (event === undefined) return;
    if (event.kind === "error") {
      this.deps.onError(event.message);
      return;
    }
    this.buffer.apply(event);
    this.deps.onText(this.buffer.text());
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
