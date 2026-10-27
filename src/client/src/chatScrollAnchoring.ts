export interface PrependScrollAnchor {
  distanceFromBottom: number;
  markerId?: string;
  markerOffset?: number;
}

export interface MarkerMeasurement {
  id: string;
  offset: number;
}

export const PREPEND_RESTORE_SETTLE_FRAMES = 30;

export function capturePrependScrollAnchor(scroller: HTMLElement, markers: HTMLElement[]): PrependScrollAnchor {
  const marker = selectPrependMarker(measureMarkers(scroller, markers));
  const base = { distanceFromBottom: scroller.scrollHeight - scroller.scrollTop };
  return marker === undefined ? base : { ...base, markerId: marker.id, markerOffset: marker.offset };
}

/** Writes only a correction of a pixel or more, so a settle frame where layout moved nothing leaves the scroll alone. */
export function restorePrependScrollAnchor(scroller: HTMLElement, anchor: PrependScrollAnchor, marker: HTMLElement | undefined): void {
  if (marker !== undefined && anchor.markerOffset !== undefined) {
    const markerOffset = marker.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const delta = scrollDeltaForMarker(markerOffset, anchor.markerOffset);
    if (Math.abs(delta) >= 1) scroller.scrollTop += delta;
    return;
  }
  const top = scrollTopForBottomDistance(scroller.scrollHeight, anchor.distanceFromBottom);
  if (Math.abs(top - scroller.scrollTop) >= 1) scroller.scrollTop = top;
}

/**
 * The anchor carried along by the reader's own scroll since the settle last wrote, so the settle
 * corrects only what layout moved and keeps the rows where the reader put them instead of writing
 * their scroll back every frame.
 */
export function anchorAfterReaderScroll(anchor: PrependScrollAnchor, readerDelta: number): PrependScrollAnchor {
  const carried = { ...anchor, distanceFromBottom: anchor.distanceFromBottom - readerDelta };
  return anchor.markerOffset === undefined ? carried : { ...carried, markerOffset: anchor.markerOffset - readerDelta };
}

export function selectPrependMarker(markers: MarkerMeasurement[]): MarkerMeasurement | undefined {
  let nearestAbove: MarkerMeasurement | undefined;
  let nearestAboveOffset = Number.NEGATIVE_INFINITY;
  let nearestBelow: MarkerMeasurement | undefined;
  let nearestBelowOffset = Number.POSITIVE_INFINITY;
  for (const marker of markers) {
    if (marker.offset <= 0 && marker.offset >= nearestAboveOffset) {
      nearestAbove = marker;
      nearestAboveOffset = marker.offset;
    } else if (marker.offset > 0 && marker.offset < nearestBelowOffset) {
      nearestBelow = marker;
      nearestBelowOffset = marker.offset;
    }
  }
  return nearestAbove ?? nearestBelow;
}

export function scrollDeltaForMarker(currentOffset: number, previousOffset: number): number {
  return currentOffset - previousOffset;
}

export function scrollTopForBottomDistance(scrollHeight: number, distanceFromBottom: number): number {
  return Math.max(0, scrollHeight - distanceFromBottom);
}

function measureMarkers(scroller: HTMLElement, markers: HTMLElement[]): MarkerMeasurement[] {
  const scrollerTop = scroller.getBoundingClientRect().top;
  return markers.flatMap((marker) => {
    const id = marker.dataset["markerId"];
    return id === undefined ? [] : [{ id, offset: marker.getBoundingClientRect().top - scrollerTop }];
  });
}
