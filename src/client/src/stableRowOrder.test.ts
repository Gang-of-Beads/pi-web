import { describe, expect, it } from "vitest";
import { createStableRowOrder } from "./stableRowOrder";

const keys = (rows: { id: string }[]) => rows.map((row) => row.id);
const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe("createStableRowOrder", () => {
  it("takes the first order it is given", () => {
    const order = createStableRowOrder<{ id: string }>((row) => row.id);
    expect(keys(order.order(rows("a", "b", "c")))).toEqual(["a", "b", "c"]);
  });

  it("keeps present rows in place when a refresh reorders them", () => {
    const order = createStableRowOrder<{ id: string }>((row) => row.id);
    order.order(rows("a", "b", "c"));
    expect(keys(order.order(rows("c", "a", "b")))).toEqual(["a", "b", "c"]);
  });

  it("appends rows that arrive rather than lifting them to the top", () => {
    const order = createStableRowOrder<{ id: string }>((row) => row.id);
    order.order(rows("a", "b"));
    expect(keys(order.order(rows("new", "a", "b")))).toEqual(["a", "b", "new"]);
  });

  it("drops rows that are gone without disturbing the rest", () => {
    const order = createStableRowOrder<{ id: string }>((row) => row.id);
    order.order(rows("a", "b", "c"));
    expect(keys(order.order(rows("a", "c")))).toEqual(["a", "c"]);
  });

  it("orders by the refreshed sequence again after a release", () => {
    const order = createStableRowOrder<{ id: string }>((row) => row.id);
    order.order(rows("a", "b"));
    order.release();
    expect(keys(order.order(rows("b", "a")))).toEqual(["b", "a"]);
  });

  it("carries the refreshed row objects, so state inside a row still updates", () => {
    const order = createStableRowOrder<{ id: string; state?: string }>((row) => row.id);
    order.order([{ id: "a" }, { id: "b" }]);
    const refreshed = order.order([{ id: "b", state: "working" }, { id: "a" }]);
    expect(refreshed.map((row) => [row.id, row.state])).toEqual([["a", undefined], ["b", "working"]]);
  });
});
