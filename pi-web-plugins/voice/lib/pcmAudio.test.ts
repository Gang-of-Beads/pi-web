import { describe, expect, it } from "vitest";
import { floatToPcm16, encodePcm16Base64, downsampleTo } from "./pcmAudio";

/**
 * Turning what the microphone gives us into what a transcription socket wants.
 *
 * The browser hands out float samples between -1 and 1 at whatever rate the
 * device runs at, usually 48 kHz. The services want signed 16-bit integers at
 * a rate they name, usually 24 kHz. Getting the conversion subtly wrong does
 * not fail loudly: it produces audio that transcribes as plausible nonsense,
 * which is far harder to diagnose than a socket that refuses to open.
 */
describe("float samples to signed 16-bit", () => {
  it("maps the ends of the range without wrapping around", () => {
    // 1 must not become -32768 through overflow, which is what makes the
    // loudest part of a phrase come back as a click.
    expect(floatToPcm16(Float32Array.from([1, -1]))).toEqual(Int16Array.from([32767, -32768]));
  });

  it("maps silence to silence", () => {
    expect(floatToPcm16(Float32Array.from([0, 0]))).toEqual(Int16Array.from([0, 0]));
  });

  it("clamps samples that overshoot rather than wrapping them", () => {
    expect(floatToPcm16(Float32Array.from([1.5, -1.5]))).toEqual(Int16Array.from([32767, -32768]));
  });

  it("keeps a half-scale sample near half scale", () => {
    const [sample] = floatToPcm16(Float32Array.from([0.5]));
    expect(sample).toBeGreaterThan(16_000);
    expect(sample).toBeLessThan(16_600);
  });
});

describe("downsampling", () => {
  it("returns the samples untouched when the rates already match", () => {
    const input = Float32Array.from([0.1, 0.2, 0.3]);
    expect(downsampleTo(input, 24_000, 24_000)).toEqual(input);
  });

  it("halves the sample count going from 48k to 24k", () => {
    const input = Float32Array.from([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(downsampleTo(input, 48_000, 24_000)).toHaveLength(3);
  });

  it("refuses to upsample rather than inventing audio", () => {
    // Sending 24k audio labelled 48k is how a service ends up transcribing
    // chipmunks; there is nothing useful to invent here.
    expect(() => downsampleTo(Float32Array.from([0, 1]), 16_000, 24_000)).toThrow(/upsample/iu);
  });
});

describe("encoding for the wire", () => {
  it("produces base64 of the little-endian bytes", () => {
    // 1 and 256 little-endian are 01 00 and 00 01.
    expect(encodePcm16Base64(Int16Array.from([1, 256]))).toBe(btoa("\u0001\u0000\u0000\u0001"));
  });

  it("encodes an empty buffer as an empty string", () => {
    expect(encodePcm16Base64(Int16Array.from([]))).toBe("");
  });
});
