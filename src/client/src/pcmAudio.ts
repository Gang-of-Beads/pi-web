/**
 * Turning what the microphone gives us into what a transcription socket wants.
 *
 * The browser hands out float samples between -1 and 1 at whatever rate the
 * device runs at, usually 48 kHz. The services want signed 16-bit integers at
 * a rate they name, usually 24 kHz. Getting this subtly wrong does not fail
 * loudly: it produces audio that transcribes as plausible nonsense, which is
 * far harder to diagnose than a socket that refuses to open.
 */

/**
 * Scale each end of the float range to the matching end of the integer range.
 *
 * The negative and positive ends are not symmetric - -32768 to 32767 - so they
 * are scaled separately. Multiplying both by 32768 makes the loudest positive
 * sample overflow to -32768, which is heard as a click on the loudest part of
 * a phrase.
 */
export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    out[index] = sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767);
  }
  return out;
}

/**
 * Drop samples to reach a lower rate.
 *
 * Upsampling is refused rather than approximated: sending 24k audio labelled
 * 48k is how a service ends up transcribing chipmunks, and there is nothing
 * useful to invent in the gaps.
 */
export function downsampleTo(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  if (fromRate < toRate) throw new Error(`Cannot upsample audio from ${String(fromRate)} to ${String(toRate)}`);
  const ratio = fromRate / toRate;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = samples[Math.floor(index * ratio)] ?? 0;
  }
  return out;
}

/** Little-endian bytes, base64 encoded, which is what the sockets accept. */
export function encodePcm16Base64(samples: Int16Array): string {
  if (samples.length === 0) return "";
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
