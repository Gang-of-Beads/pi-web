import { describe, expect, it } from "vitest";
import { peakLevel } from "./browserVoiceRecorder";

/**
 * Only the level maths is unit-testable here; the rest of the file is calls
 * into getUserMedia, MediaRecorder and AnalyserNode, which is why every
 * decision that could be wrong lives in the tested layers above it.
 */
describe("peakLevel", () => {
  it("reports silence as zero", () => {
    // Time-domain samples are centred on 128.
    expect(peakLevel(new Uint8Array([128, 128, 128]))).toBe(0);
  });

  it("reports a full-scale signal as one", () => {
    expect(peakLevel(new Uint8Array([0, 128, 255]))).toBe(1);
  });

  it("measures deviation in either direction", () => {
    expect(peakLevel(new Uint8Array([128, 64]))).toBeCloseTo(0.5, 5);
    expect(peakLevel(new Uint8Array([128, 192]))).toBeCloseTo(0.5, 5);
  });

  it("takes the peak, not the average", () => {
    // One loud sample among quiet ones is a word starting; an average would
    // smooth it away and the VAD would miss the start of speech.
    const mostlyQuiet = new Uint8Array([128, 128, 128, 128, 200, 128, 128, 128]);
    expect(peakLevel(mostlyQuiet)).toBeCloseTo(0.5625, 4);
  });

  it("handles an empty frame without producing NaN", () => {
    expect(peakLevel(new Uint8Array([]))).toBe(0);
  });
});
