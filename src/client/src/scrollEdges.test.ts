import { describe, expect, it, vi } from "vitest";
import { horizontalScrollEdges, scrollEdgeClasses, ScrollEdgeTracker } from "./scrollEdges";

describe("horizontalScrollEdges", () => {
  it("reports nothing for a row that fits", () => {
    expect(horizontalScrollEdges({ scrollLeft: 0, scrollWidth: 240, clientWidth: 240 })).toEqual({ left: false, right: false });
  });

  // Measured from the real drawer tabs: two tabs need 261px and get 240.
  it("points right while the end of the row is out of sight", () => {
    expect(horizontalScrollEdges({ scrollLeft: 0, scrollWidth: 261, clientWidth: 240 })).toEqual({ left: false, right: true });
  });

  it("points both ways from the middle and only back at the end", () => {
    expect(horizontalScrollEdges({ scrollLeft: 10, scrollWidth: 261, clientWidth: 240 })).toEqual({ left: true, right: true });
    expect(horizontalScrollEdges({ scrollLeft: 21, scrollWidth: 261, clientWidth: 240 })).toEqual({ left: true, right: false });
  });

  // Sub-pixel layout leaves a sliver of scroll room on rows that really do fit.
  it("ignores a sub-pixel sliver", () => {
    expect(horizontalScrollEdges({ scrollLeft: 0.5, scrollWidth: 240.4, clientWidth: 240 })).toEqual({ left: false, right: false });
  });

  it("says nothing when there is no strip to measure", () => {
    expect(horizontalScrollEdges(undefined)).toEqual({ left: false, right: false });
  });
});

describe("scrollEdgeClasses", () => {
  it("names only the edges that have more to reach", () => {
    expect(scrollEdgeClasses({ left: false, right: false })).toBe("");
    expect(scrollEdgeClasses({ left: false, right: true })).toBe(" can-scroll-right");
    expect(scrollEdgeClasses({ left: true, right: true })).toBe(" can-scroll-left can-scroll-right");
  });
});

describe("ScrollEdgeTracker", () => {
  function strip(metrics: { scrollLeft: number; scrollWidth: number; clientWidth: number }): HTMLElement {
    const element = { ...metrics, tagName: "DIV" };
    if (!isHtmlElement(element)) throw new Error("expected a stand-in element");
    return element;
  }

  function isHtmlElement(value: { scrollLeft: number; scrollWidth: number; clientWidth: number }): value is HTMLElement {
    return typeof value.scrollWidth === "number";
  }

  it("reports a change once and stays quiet while the answer holds", () => {
    const onChange = vi.fn();
    const tracker = new ScrollEdgeTracker(onChange, () => undefined);

    tracker.observe(strip({ scrollLeft: 0, scrollWidth: 261, clientWidth: 240 }));
    expect(tracker.edges).toEqual({ left: false, right: true });
    expect(onChange).toHaveBeenCalledTimes(1);

    tracker.refresh();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // A row that fits on a wide window starts hiding its last tab when the window
  // narrows, without anyone having scrolled.
  it("watches for resizes, not just scrolls", () => {
    const onChange = vi.fn();
    let fireResize = (): void => undefined;
    const tracker = new ScrollEdgeTracker(onChange, (callback) => {
      fireResize = callback;
      return { observe: () => undefined, disconnect: () => undefined };
    });
    const element = strip({ scrollLeft: 0, scrollWidth: 240, clientWidth: 240 });

    tracker.observe(element);
    expect(tracker.edges).toEqual({ left: false, right: false });
    expect(onChange).not.toHaveBeenCalled();

    Reflect.set(element, "clientWidth", 200);
    fireResize();

    expect(tracker.edges).toEqual({ left: false, right: true });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("drops the old strip when pointed at a new one", () => {
    const disconnects: number[] = [];
    const tracker = new ScrollEdgeTracker(() => undefined, () => ({
      observe: () => undefined,
      disconnect: () => { disconnects.push(disconnects.length); },
    }));

    tracker.observe(strip({ scrollLeft: 0, scrollWidth: 261, clientWidth: 240 }));
    tracker.observe(strip({ scrollLeft: 0, scrollWidth: 100, clientWidth: 240 }));

    expect(disconnects.length).toBe(1);
    expect(tracker.edges).toEqual({ left: false, right: false });
  });

  it("forgets everything when disposed", () => {
    const tracker = new ScrollEdgeTracker(() => undefined, () => ({ observe: () => undefined, disconnect: () => undefined }));
    tracker.observe(strip({ scrollLeft: 0, scrollWidth: 261, clientWidth: 240 }));

    tracker.dispose();

    expect(tracker.edges).toEqual({ left: false, right: false });
  });
});
