// pi owns the set of thinking levels; this union mirrors it because the published
// plugin contract must carry no host dependency, and the HTTP/wire contract
// (apiTypes.ts) keeps using `string` so an unknown level reported by a newer pi
// runtime degrades gracefully instead of failing to parse. thinkingLevels.test.ts
// pins the mirror against pi's union in both directions.
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Known levels in increasing intensity, kept in sync with pi's `ThinkingLevel`
 * union by thinkingLevels.test.ts's two-direction type assertions. When they
 * break, update this list and give the new level a label/description where
 * thinking levels are presented.
 */
export const KNOWN_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const satisfies readonly ThinkingLevel[];

export function isKnownThinkingLevel(value: string): value is ThinkingLevel {
  return KNOWN_THINKING_LEVELS.some((level) => level === value);
}

export function thinkingLevelLabel(level: string | undefined): string {
  return level === undefined || level === "" ? "off" : level;
}

export interface ThinkingGauge {
  /** Number of bars to render (the non-"off" levels). */
  total: number;
  /** Number of filled bars for the current level. */
  filled: number;
}

/**
 * Describe a thinking-level gauge from the available set rather than a hardcoded
 * table, so it stays correct even if pi changes the available levels at runtime.
 *
 * Convention: the first available level is treated as "no thinking". The gauge
 * therefore renders one bar per remaining level, and fills up to the current
 * level's rank. An unknown current level fills 0 bars instead of throwing.
 */
export function thinkingGauge(level: string | undefined, available: readonly string[]): ThinkingGauge {
  const pool = available.length >= 2 ? available : KNOWN_THINKING_LEVELS;
  const total = pool.length - 1;
  const normalized = thinkingLevelLabel(level);
  const index = pool.indexOf(normalized);
  const filled = index <= 0 ? 0 : Math.min(index, total);
  return { total, filled };
}
