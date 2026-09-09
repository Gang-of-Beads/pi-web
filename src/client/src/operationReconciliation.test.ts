// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseOperationOutcomes } from "./api/parsers.js";

/**
 * Absence is not negation.
 *
 * The daemon answers only for identities it holds rows for. A client that
 * treated a missing id as a failure would tell the reader a message is gone
 * when the truth is that nobody knows - which is the exact mistake the
 * unverifiable state exists to prevent.
 */
describe("reconciling operations after a reconnect", () => {
  it("keeps an identity the daemon said nothing about out of the answer", () => {
    const outcomes = parseOperationOutcomes({ outcomes: { "cm-1": "succeeded" } });
    expect(outcomes["cm-1"]).toBe("succeeded");
    expect("cm-2" in outcomes).toBe(false);
  });

  it("answers nothing rather than guessing when the payload is not what it expects", () => {
    expect(parseOperationOutcomes(undefined)).toEqual({});
    expect(parseOperationOutcomes({})).toEqual({});
    expect(parseOperationOutcomes({ outcomes: "no" })).toEqual({});
    expect(parseOperationOutcomes({ outcomes: { "cm-1": 7 } })).toEqual({});
  });
});
