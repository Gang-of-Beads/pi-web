import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * D8/4.2: the 4s subagent/activity poll is removed — the strip refetches on
 * the count-change signal (the daemon's status frames carry it), on selection,
 * and on visibility recovery. The pin walks PiWebApp's source and asserts the
 * interval and its constant are gone, so the timer cannot quietly return.
 */
describe("the subagent poll stays removed", () => {
  it("no longer arms a 4s subagent interval", () => {
    const file = fileURLToPath(new URL("./PiWebApp.ts", import.meta.url));
    const source = readFileSync(file, "utf8");
    expect(source).not.toContain("SUBAGENT_REFRESH_MS");
    expect(source).not.toContain("subagentPollTimer");
  });
});
