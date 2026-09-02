import { describe, expect, it } from "vitest";
import { parseSessionStatus } from "./parsers";

/**
 * The third feature lost to this parser, caught before it shipped.
 *
 * This parser builds its result field by field, so a field it does not name is
 * dropped in silence. Speech input could not be enabled from the day it
 * shipped. The background-run count coloured every session grey. Plugin
 * surface presence would have been the third: the daemon computed it, sent it,
 * and the browser read undefined forever - which reads as "nobody could tell",
 * so the panel always showed and the feature did nothing at all.
 *
 * The silence is the hazard: each of these looked finished, passed its own unit
 * tests, and changed nothing. A field is only wired when a test asserts it
 * survives the wire.
 */

function wireStatus(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    sessionId: "s1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    messageCount: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...extra,
  };
}

describe("plugin surface presence crossing the wire", () => {
  it("survives the parser instead of being dropped in silence", () => {
    expect(parseSessionStatus(wireStatus({ pluginSurfaces: { goals: "absent" } })).pluginSurfaces).toEqual({ goals: "absent" });
  });

  it("carries a failed plugin through, so a broken install stays visible", () => {
    expect(parseSessionStatus(wireStatus({ pluginSurfaces: { goals: "failed" } })).pluginSurfaces).toEqual({ goals: "failed" });
  });

  /**
   * Unknown must arrive as unknown. It is what tells the browser nobody has
   * established whether the surface exists, and a panel is kept on that answer
   * rather than hidden.
   */
  it("leaves the field absent when the daemon said nothing", () => {
    expect(parseSessionStatus(wireStatus({})).pluginSurfaces).toBeUndefined();
  });

  /** A value this build does not understand is not evidence of absence. */
  it("drops a state it does not recognise rather than trusting it", () => {
    expect(parseSessionStatus(wireStatus({ pluginSurfaces: { goals: "banana" } })).pluginSurfaces).toBeUndefined();
  });

  it("does not fall over on a malformed payload", () => {
    expect(parseSessionStatus(wireStatus({ pluginSurfaces: "yes" })).pluginSurfaces).toBeUndefined();
  });
});
