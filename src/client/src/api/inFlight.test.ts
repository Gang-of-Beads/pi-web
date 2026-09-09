// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { dedupeKey, inFlightCount, resetInFlight, shareInFlight } from "./inFlight.js";

afterEach(() => { resetInFlight(); });

describe("sharing a read that is already in flight", () => {
  it("shares only reads", () => {
    expect(dedupeKey("api/sessions", undefined)).toBe("GET api/sessions");
    expect(dedupeKey("api/sessions", "get")).toBe("GET api/sessions");
    expect(dedupeKey("api/sessions", "POST")).toBeUndefined();
    expect(dedupeKey("api/sessions", "DELETE")).toBeUndefined();
  });

  it("runs one request for concurrent askers and gives each the answer", async () => {
    const start = vi.fn(() => Promise.resolve("answer"));
    const [first, second] = await Promise.all([shareInFlight("GET x", start), shareInFlight("GET x", start)]);
    expect(start).toHaveBeenCalledTimes(1);
    expect([first, second]).toEqual(["answer", "answer"]);
  });

  it("gives every asker the same failure and then forgets it", async () => {
    const start = vi.fn(() => Promise.reject(new Error("no")));
    const results = await Promise.allSettled([shareInFlight("GET y", start), shareInFlight("GET y", start)]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(inFlightCount()).toBe(0);
  });

  /** A shared entry is not a cache: the next ask must be a fresh read. */
  it("does not answer a later ask from a settled request", async () => {
    const start = vi.fn(() => Promise.resolve("first"));
    await shareInFlight("GET z", start);
    await shareInFlight("GET z", start);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("does not share when there is no key", async () => {
    const start = vi.fn(() => Promise.resolve("written"));
    await Promise.all([shareInFlight(undefined, start), shareInFlight(undefined, start)]);
    expect(start).toHaveBeenCalledTimes(2);
  });
});
