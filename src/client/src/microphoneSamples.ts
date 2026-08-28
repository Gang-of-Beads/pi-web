/**
 * Opens the microphone and reports raw samples as they arrive, so a sentence
 * can be transcribed while it is still being spoken.
 */
export type SampleListener = (samples: Float32Array, sampleRate: number) => void;

const WORKLET_SOURCE = `
class SampleTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) this.port.postMessage(new Float32Array(channel));
    return true;
  }
}
registerProcessor("sample-tap", SampleTap);
`;

export async function captureMicrophoneSamples(onSamples: SampleListener): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }

  const source = context.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(context, "sample-tap");
  tap.port.onmessage = (event: MessageEvent<Float32Array>) => { onSamples(event.data, context.sampleRate); };
  source.connect(tap);

  return () => {
    tap.port.onmessage = null;
    tap.disconnect();
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };
}
