import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Section 4 of session-state-consistency: every poll that remains in the
 * client must name the surface it backs up, right at its constant or timer
 * setup, so the next reader can tell backup-poll from core mechanism without
 * archaeology - and so the polls section 4.1/4.2 remove cannot quietly grow
 * back. The contract is mechanical: each `setInterval` in production client
 * code needs a comment containing `Surface backed up:` within the three lines
 * above it. Timers that are not polls (clock ticks, media capture, countdowns)
 * satisfy it the same way by naming what they drive.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("every remaining client timer names the surface it backs up", () => {
  it("has a 'Surface backed up:' comment above each setInterval", () => {
    const root = join(import.meta.dirname);
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!line.includes("setInterval")) return;
        const above = lines.slice(Math.max(0, index - 3), index).join("\n");
        if (!above.includes("Surface backed up:")) offenders.push(`${file}:${String(index + 1)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
