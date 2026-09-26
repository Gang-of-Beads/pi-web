import { describe, expect, it } from "vitest";
import { settleOutbox } from "./outboxSettlement.js";

describe("settling the outbox against the transcript", () => {
  it("drops the row whose message the transcript already shows", () => {
    const settled = settleOutbox(["a", "b"], (id) => id === "a");
    expect(settled).toEqual({ keep: ["b"], drop: ["a"] });
  });

  it("keeps every row while nothing is delivered", () => {
    expect(settleOutbox(["a", "b"], () => false)).toEqual({ keep: ["a", "b"], drop: [] });
  });

  it("drops every row once the transcript has them", () => {
    expect(settleOutbox(["a", "b"], () => true)).toEqual({ keep: [], drop: ["a", "b"] });
  });

  it("is empty for an empty outbox", () => {
    expect(settleOutbox([], () => true)).toEqual({ keep: [], drop: [] });
  });
});
