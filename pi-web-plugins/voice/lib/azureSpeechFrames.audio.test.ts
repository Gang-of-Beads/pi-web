import { describe, expect, it } from "vitest";
import { encodeAzureAudioFrame } from "./azureSpeechFrames";
import { AZURE_SAMPLE_RATE } from "./liveDictation";
import { pcm16Bytes } from "./pcmAudio";

/**
 * Azure carries audio in binary frames, not in JSON.
 *
 * Dictation sent each chunk as a text frame with the samples base64-encoded in
 * a JSON body. The service accepts that socket, answers `turn.start`, and then
 * says nothing at all: it never recognises the audio, never reports an error
 * and never closes. Live probes against the real endpoint, same token and same
 * samples, differ only in the framing:
 *
 *   audio as a text frame:    turn.start
 *   audio as a binary frame:  turn.start, speech.phrase, speech.endDetected,
 *                             speech.phrase, turn.end
 *
 * The wire format is a big-endian uint16 header length, the ASCII header
 * block, then the raw bytes.
 */

function headerLengthOf(frame: Uint8Array): number {
  return ((frame[0] ?? 0) << 8) | (frame[1] ?? 0);
}

function headerTextOf(frame: Uint8Array): string {
  return new TextDecoder().decode(frame.subarray(2, 2 + headerLengthOf(frame)));
}

function payloadOf(frame: Uint8Array): Uint8Array {
  return frame.subarray(2 + headerLengthOf(frame));
}

const REQUEST_ID = "0123456789abcdef0123456789abcdef";

describe("the audio frame Azure accepts", () => {
  it("prefixes the header block with its big-endian length", () => {
    const frame = encodeAzureAudioFrame(REQUEST_ID, new Uint8Array([1, 2, 3, 4]));

    const declared = headerLengthOf(frame);
    expect(declared).toBe(headerTextOf(frame).length);
  });

  it("names the path and the request the chunk belongs to", () => {
    const headers = headerTextOf(encodeAzureAudioFrame(REQUEST_ID, new Uint8Array([0])));

    expect(headers).toContain("Path:audio");
    expect(headers).toContain(`X-RequestId:${REQUEST_ID}`);
  });

  it("carries the samples as raw bytes, not as text", () => {
    const samples = new Uint8Array([0, 1, 254, 255, 128]);

    const carried = payloadOf(encodeAzureAudioFrame(REQUEST_ID, samples));

    expect([...carried]).toEqual([...samples]);
  });

  /** The empty chunk is how the client says the utterance is over. */
  it("encodes an end-of-stream chunk with headers and no payload", () => {
    const frame = encodeAzureAudioFrame(REQUEST_ID, new Uint8Array(0));

    expect(payloadOf(frame)).toHaveLength(0);
    expect(headerTextOf(frame)).toContain("Path:audio");
  });

  it("separates headers from payload with a blank line", () => {
    const headers = headerTextOf(encodeAzureAudioFrame(REQUEST_ID, new Uint8Array([7])));

    expect(headers.endsWith("\r\n\r\n")).toBe(true);
  });
});

/**
 * The wire format is agreed in two files that do not reference each other.
 *
 * The frame header names audio/x-wav while the payload is headerless PCM; that
 * only works because the service's default input format happens to equal what
 * the capture path produces. These pin both halves, so changing one without the
 * other fails here rather than as silence in the composer.
 */
describe("the audio format the header implies", () => {
  it("captures at the rate the service assumes by default", () => {
    expect(AZURE_SAMPLE_RATE).toBe(16_000);
  });

  it("sends two bytes per sample, which is what 16-bit mono means", () => {
    const samples = Int16Array.from([0, 1, -1, 32_767]);

    expect(pcm16Bytes(samples).byteLength).toBe(samples.length * 2);
  });
});
