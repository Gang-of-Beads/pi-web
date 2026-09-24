import { describe, expect, it } from "vitest";
import { IDENTITY_ZOOM, MAX_ZOOM, pinchZoom, panZoom, wheelZoom } from "./imageZoomGesture";

/**
 * Owner request: "照片预览加一个pinch放大缩小功能吧". The picture is opened at fit
 * size, so a screenshot's small print is unreadable on a phone; pinch is the
 * gesture that fixes it, and the maths has to anchor on the fingers rather than
 * on the picture's centre or the thing being read swims away.
 */
const start = (distance: number, midpoint = { x: 0, y: 0 }) => ({ distance, midpoint, transform: IDENTITY_ZOOM });

describe("pinching a preview", () => {
  it("scales by the change in finger distance", () => {
    expect(pinchZoom(start(100), { distance: 250, midpoint: { x: 0, y: 0 } })).toEqual({ scale: 2.5, x: 0, y: 0 });
  });

  it("keeps the point between the fingers still", () => {
    // Fingers spread around a point 30px right of centre; that point must stay
    // under them, so the picture translates left by (scale - 1) * 30.
    const zoomed = pinchZoom({ distance: 100, midpoint: { x: 30, y: 0 }, transform: IDENTITY_ZOOM }, { distance: 200, midpoint: { x: 30, y: 0 } });

    expect(zoomed.scale).toBe(2);
    expect(zoomed.x).toBe(-30);
    expect(zoomed.y).toBe(0);
  });

  it("follows the fingers as the midpoint moves", () => {
    const zoomed = pinchZoom({ distance: 100, midpoint: { x: 0, y: 0 }, transform: IDENTITY_ZOOM }, { distance: 200, midpoint: { x: 40, y: 10 } });

    expect(zoomed).toEqual({ scale: 2, x: 40, y: 10 });
  });

  it("stops at the ceiling and at nothing-to-see", () => {
    expect(pinchZoom(start(10), { distance: 1000, midpoint: { x: 0, y: 0 } }).scale).toBe(MAX_ZOOM);
    // Pinching back under fit size snaps home rather than showing a margin.
    expect(pinchZoom(start(200), { distance: 100, midpoint: { x: 12, y: 4 } })).toEqual(IDENTITY_ZOOM);
  });

  it("survives a degenerate start distance", () => {
    expect(pinchZoom(start(0), { distance: 120, midpoint: { x: 0, y: 0 } })).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

describe("moving a zoomed preview", () => {
  it("carries the picture with the finger", () => {
    expect(panZoom({ x: 0, y: 0 }, { x: 20, y: -8 }, { scale: 2, x: 0, y: 0 })).toEqual({ scale: 2, x: 20, y: -8 });
  });

  it("cannot move a picture that fits", () => {
    expect(panZoom({ x: 0, y: 0 }, { x: 20, y: -8 }, IDENTITY_ZOOM)).toEqual(IDENTITY_ZOOM);
  });
});

describe("zooming with a wheel", () => {
  it("anchors on the cursor", () => {
    const zoomed = wheelZoom(IDENTITY_ZOOM, 2, { x: 30, y: 0 });

    expect(zoomed.scale).toBe(2);
    expect(zoomed.x).toBe(-30);
  });

  it("returns home when zoomed all the way out", () => {
    expect(wheelZoom({ scale: 1.2, x: 5, y: 5 }, 0.5, { x: 0, y: 0 })).toEqual(IDENTITY_ZOOM);
  });
});
