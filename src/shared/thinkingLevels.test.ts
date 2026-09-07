import { describe, expect, it } from "vitest";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ThinkingLevel as LocalThinkingLevel } from "./thinkingLevels";
import { KNOWN_THINKING_LEVELS, isKnownThinkingLevel, thinkingGauge, thinkingLevelLabel } from "./thinkingLevels";

// Compile-time drift guards, pinned in both directions twice over: `Extra` and
// `Stale` pin the level array to pi's union, and `LocalExtra`/`LocalStale` pin
// the exported ThinkingLevel mirror itself. When any breaks, update the union
// in thinkingLevels.ts and give the new level a label/description where
// thinking levels are presented.
type Extra = Exclude<ThinkingLevel, (typeof KNOWN_THINKING_LEVELS)[number]>;
const _noUnknownLevels: Extra extends never ? true : never = true;
void _noUnknownLevels;

type Stale = Exclude<(typeof KNOWN_THINKING_LEVELS)[number], ThinkingLevel>;
const _noStaleLevels: Stale extends never ? true : never = true;
void _noStaleLevels;

type LocalExtra = Exclude<LocalThinkingLevel, ThinkingLevel>;
const _noLocalExtraLevels: LocalExtra extends never ? true : never = true;
void _noLocalExtraLevels;

type LocalStale = Exclude<ThinkingLevel, LocalThinkingLevel>;
const _noLocalStaleLevels: LocalStale extends never ? true : never = true;
void _noLocalStaleLevels;

describe("thinkingLevels", () => {
  it("recognizes all known levels and rejects others", () => {
    for (const level of KNOWN_THINKING_LEVELS) expect(isKnownThinkingLevel(level)).toBe(true);
    expect(isKnownThinkingLevel("ultra")).toBe(false);
    expect(isKnownThinkingLevel("")).toBe(false);
  });

  it("labels levels, defaulting empty/undefined to off", () => {
    expect(thinkingLevelLabel(undefined)).toBe("off");
    expect(thinkingLevelLabel("")).toBe("off");
    expect(thinkingLevelLabel("high")).toBe("high");
    expect(thinkingLevelLabel("brand-new-level")).toBe("brand-new-level");
  });

  describe("thinkingGauge", () => {
    const known = KNOWN_THINKING_LEVELS;

    it("derives bar count from the available set (excluding the off level)", () => {
      // 7 known levels => 6 bars.
      expect(thinkingGauge("off", known).total).toBe(6);
      expect(thinkingGauge("off", ["off", "low", "high"]).total).toBe(2);
    });

    it("treats the first level as no thinking (0 filled)", () => {
      expect(thinkingGauge("off", known)).toEqual({ total: 6, filled: 0 });
      expect(thinkingGauge(undefined, known)).toEqual({ total: 6, filled: 0 });
    });

    it("fills up to the current level's rank", () => {
      expect(thinkingGauge("minimal", known).filled).toBe(1);
      expect(thinkingGauge("low", known).filled).toBe(2);
      expect(thinkingGauge("medium", known).filled).toBe(3);
      expect(thinkingGauge("high", known).filled).toBe(4);
      expect(thinkingGauge("xhigh", known).filled).toBe(5);
      expect(thinkingGauge("max", known).filled).toBe(6);
    });

    it("adapts to a runtime-provided set of a different size", () => {
      const available = ["off", "low", "high"];
      expect(thinkingGauge("off", available)).toEqual({ total: 2, filled: 0 });
      expect(thinkingGauge("low", available)).toEqual({ total: 2, filled: 1 });
      expect(thinkingGauge("high", available)).toEqual({ total: 2, filled: 2 });
    });

    it("falls back to the known set when no usable available set is given", () => {
      expect(thinkingGauge("high", [])).toEqual({ total: 6, filled: 4 });
      expect(thinkingGauge("high", ["only-one"])).toEqual({ total: 6, filled: 4 });
    });

    it("fills 0 for an unknown current level instead of throwing", () => {
      expect(thinkingGauge("brand-new-level", known).filled).toBe(0);
    });
  });
});
