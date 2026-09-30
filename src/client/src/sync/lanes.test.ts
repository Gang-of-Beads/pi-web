import { describe, expect, it } from "vitest";
import { mapWithLanes } from "./lanes";

describe("reading many sources through a few lanes (object model §4.5)", () => {
  it("runs at most the lane count at once, and answers in the order asked", async () => {
    let running = 0;
    let peak = 0;
    const read = async (value: number): Promise<number> => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5 * (8 - value)));
      running -= 1;
      return value * 10;
    };

    const answers = await mapWithLanes([1, 2, 3, 4, 5, 6, 7], 2, read);

    expect({ answers, peak }).toEqual({ answers: [10, 20, 30, 40, 50, 60, 70], peak: 2 });
  });

  it("rejects with the first read that fails, and starts no more reads after it", async () => {
    const started: number[] = [];
    const reading = mapWithLanes([1, 2, 3, 4, 5], 2, async (value) => {
      started.push(value);
      if (value === 1) throw new Error("one");
      await new Promise((resolve) => setTimeout(resolve, 5));
      return value;
    });

    await expect(reading).rejects.toThrow("one");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toEqual([1, 2]);
  });

  it("reads one at a time when asked for no lanes", async () => {
    let running = 0;
    let peak = 0;
    const answers = await mapWithLanes([1, 2, 3], 0, async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      return value;
    });

    expect({ answers, peak }).toEqual({ answers: [1, 2, 3], peak: 1 });
  });

  it("answers nothing for nothing, and keeps going past a read that fails", async () => {
    const outcomes = await mapWithLanes([1, 2, 3], 2, (value) => (value === 2 ? Promise.reject(new Error("two")) : Promise.resolve(value)).then((answer) => ({ answer }), (error: unknown) => ({ error: String(error) })));

    expect({ empty: await mapWithLanes([], 2, (value: number) => Promise.resolve(value)), outcomes }).toEqual({ empty: [], outcomes: [{ answer: 1 }, { error: "Error: two" }, { answer: 3 }] });
  });
});
