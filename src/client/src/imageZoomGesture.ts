/**
 * Pinch-and-pan arithmetic for a zoomed preview.
 *
 * The preview used to be a fixed-size picture in a dialog: on a phone the only
 * way to read a screenshot's small print was to open it, and there was nothing
 * to do next. Pinch is the gesture a phone reader already has, so the maths
 * lives here rather than in the component's pointer handlers.
 *
 * The transform is expressed against the picture's own box: `scale` multiplies
 * it, and `x`/`y` are the translation applied after scaling. A pinch keeps the
 * point under the fingers still, which is the whole difference between zooming
 * and watching the picture swim away.
 */
export interface ZoomTransform {
  scale: number;
  x: number;
  y: number;
}

export const IDENTITY_ZOOM: ZoomTransform = { scale: 1, x: 0, y: 0 };

/** Comfortable range: below 1 there is nothing to see, above this it is mush. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

export interface PinchPoint {
  /** Distance between the two fingers, in CSS pixels. */
  distance: number;
  /** Midpoint between the two fingers, relative to the picture's centre. */
  midpoint: { x: number; y: number };
}

/** A pinch in progress: where it started, and the transform it started from. */
export interface PinchStart extends PinchPoint {
  transform: ZoomTransform;
}

/**
 * What a pinch does to the picture.
 *
 * Scaling is the ratio of the finger distances. The translation is whatever
 * keeps the point the reader is looking at - the midpoint between their
 * fingers - under their fingers while it happens: the picture point under the
 * start midpoint must land under the current one.
 */
export function pinchZoom(start: PinchStart, current: PinchPoint): ZoomTransform {
  const ratio = start.distance <= 0 ? 1 : current.distance / start.distance;
  const scale = clampScale(start.transform.scale * ratio);
  if (scale <= MIN_ZOOM) return IDENTITY_ZOOM;
  const grown = scale / start.transform.scale;
  return {
    scale,
    x: current.midpoint.x - (start.midpoint.x - start.transform.x) * grown,
    y: current.midpoint.y - (start.midpoint.y - start.transform.y) * grown,
  };
}

/** A drag with one finger, once the picture is zoomed in. */
export function panZoom(origin: { x: number; y: number }, current: { x: number; y: number }, at: ZoomTransform): ZoomTransform {
  if (at.scale <= MIN_ZOOM) return IDENTITY_ZOOM;
  return { scale: at.scale, x: at.x + (current.x - origin.x), y: at.y + (current.y - origin.y) };
}

/** Wheel zoom, anchored at the cursor so the point under it stays put. */
export function wheelZoom(at: ZoomTransform, factor: number, point: { x: number; y: number }): ZoomTransform {
  const scale = clampScale(at.scale * factor);
  if (scale <= MIN_ZOOM) return IDENTITY_ZOOM;
  const grown = scale / at.scale;
  return { scale, x: at.x - (point.x - at.x) * (grown - 1), y: at.y - (point.y - at.y) * (grown - 1) };
}

function clampScale(scale: number): number {
  if (!Number.isFinite(scale) || scale < MIN_ZOOM) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, scale);
}
