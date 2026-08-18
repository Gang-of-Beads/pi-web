import type { VoiceRecorder } from "./voiceController";

/**
 * The browser half of dictation: microphone in, audio blob and loudness out.
 *
 * Kept behind the `VoiceRecorder` interface so the controller's sequencing is
 * testable without a device. This file is the part that cannot be unit-tested
 * meaningfully — it is almost entirely calls into `getUserMedia`,
 * `MediaRecorder` and `AnalyserNode` — so it is deliberately thin, with every
 * decision that could be wrong pushed up into the tested layers.
 */

/** How often loudness is sampled. Frequent enough for the VAD thresholds. */
const FRAME_INTERVAL_MS = 100;

export function createBrowserVoiceRecorder(): VoiceRecorder {
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let audioContext: AudioContext | undefined;
  let frameTimer: number | undefined;
  let chunks: Blob[] = [];

  const release = (): void => {
    if (frameTimer !== undefined) {
      window.clearInterval(frameTimer);
      frameTimer = undefined;
    }
    // Stopping the tracks is what turns the browser's recording indicator off;
    // leaving them live would keep the microphone visibly in use.
    stream?.getTracks().forEach((track) => { track.stop(); });
    stream = undefined;
    void audioContext?.close().catch(() => undefined);
    audioContext = undefined;
    recorder = undefined;
  };

  return {
    async start(onFrame) {
      chunks = [];
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      recorder = new MediaRecorder(stream);
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.start();

      // Loudness is read from an analyser rather than the recorded blob so the
      // VAD can react while recording, not after it.
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);

      frameTimer = window.setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        onFrame(peakLevel(samples), FRAME_INTERVAL_MS);
      }, FRAME_INTERVAL_MS);
    },

    stop() {
      const active = recorder;
      if (active === undefined) {
        release();
        return Promise.resolve(new Blob([]));
      }
      return new Promise<Blob>((resolve) => {
        active.addEventListener("stop", () => {
          const type = chunks[0]?.type ?? "audio/webm";
          const audio = new Blob(chunks, { type });
          release();
          resolve(audio);
        }, { once: true });
        active.stop();
      });
    },

    cancel() {
      // Discard rather than resolve: the caller abandoned this recording, and
      // handing back audio it never asked for would be worse than nothing.
      chunks = [];
      if (recorder?.state === "recording") recorder.stop();
      release();
    },
  };
}

/**
 * Peak deviation from silence in a frame, 0..1.
 *
 * Peak rather than average: a single word in an otherwise quiet frame should
 * register as speech, which an average would smooth away.
 */
export function peakLevel(samples: Uint8Array): number {
  let peak = 0;
  for (const sample of samples) {
    // Time-domain data is centred on 128; distance from it is amplitude.
    const amplitude = Math.abs(sample - 128) / 128;
    if (amplitude > peak) peak = amplitude;
  }
  return peak;
}
