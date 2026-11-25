import { describe, expect, it } from "vitest";
import { parseDeclaredStates } from "./declaredSessionStates";

describe("the states an owner publishes", () => {
  const state = { id: "runs", label: " 2 runs ", tone: "accent", busy: true, count: 2 };

  it("are read with their owner, and an empty list is a real answer", () => {
    expect([parseDeclaredStates("background", [state]), parseDeclaredStates("background", [])])
      .toEqual([[{ owner: "background", id: "runs", label: "2 runs", tone: "accent", busy: true, count: 2 }], []]);
  });

  it("are refused whole when any of them is malformed, so a half-read list never shows", () => {
    const refused = [
      "not a list",
      [{ ...state, tone: "purple" }],
      [{ ...state, busy: "yes" }],
      [{ ...state, id: "Runs" }],
      [{ ...state, label: "" }],
      [{ ...state, count: -1 }],
      [state, state],
      Array.from({ length: 9 }, (_, index) => ({ ...state, id: `s${String(index)}` })),
    ].map((value) => parseDeclaredStates("background", value));
    expect(refused).toEqual(refused.map(() => undefined));
  });
});
