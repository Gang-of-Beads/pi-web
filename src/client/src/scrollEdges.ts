/**
 * Telling a reader that a strip of controls continues past its edge.
 *
 * A row that scrolls sideways with its scrollbar hidden looks exactly like a
 * row that fits: whatever sits past the edge is simply gone, and nothing
 * suggests there is more to reach. The drawer tabs and the workspace tool tabs
 * both do this, so the fade that says "keep going" is driven from one place.
 */

/** The measurements an edge decision needs, so a plain object can stand in for an element. */
export interface ScrollEdgeMetrics {
  readonly scrollLeft: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

/** Which side of a horizontal scroller still has content beyond it. */
export interface ScrollEdges {
  readonly left: boolean;
  readonly right: boolean;
}

export const NO_SCROLL_EDGES: ScrollEdges = { left: false, right: false };

/**
 * Sub-pixel layout leaves a fraction of a pixel of scroll room on rows that
 * actually fit, so a whole pixel has to be reachable before the fade claims
 * there is something past the edge.
 */
const EDGE_THRESHOLD_PX = 1;

export function horizontalScrollEdges(metrics: ScrollEdgeMetrics | undefined): ScrollEdges {
  if (metrics === undefined) return NO_SCROLL_EDGES;
  const maxScrollLeft = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
  return {
    left: metrics.scrollLeft > EDGE_THRESHOLD_PX,
    right: maxScrollLeft - metrics.scrollLeft > EDGE_THRESHOLD_PX,
  };
}

/** Class names a fade frame reads, so the markup and the CSS agree in one place. */
export function scrollEdgeClasses(edges: ScrollEdges): string {
  return `${edges.left ? " can-scroll-left" : ""}${edges.right ? " can-scroll-right" : ""}`;
}

type ObservedElement = HTMLElement | undefined;

interface ResizeObserverLike {
  observe: (target: Element) => void;
  disconnect: () => void;
}

type ResizeObserverFactory = (callback: () => void) => ResizeObserverLike | undefined;

const browserResizeObserverFactory: ResizeObserverFactory = (callback) => {
  if (typeof ResizeObserver === "undefined") return undefined;
  return new ResizeObserver(() => { callback(); });
};

/**
 * Keeps a scroller's edge state current as it is scrolled and as it is resized.
 *
 * Resizing matters as much as scrolling: a row that fits on a wide window
 * starts hiding its last tab when the window narrows, without anyone having
 * scrolled at all.
 */
export class ScrollEdgeTracker {
  private element: ObservedElement;
  private observer: ResizeObserverLike | undefined;
  private current: ScrollEdges = NO_SCROLL_EDGES;

  constructor(
    private readonly onChange: () => void,
    private readonly createObserver: ResizeObserverFactory = browserResizeObserverFactory,
  ) {}

  get edges(): ScrollEdges {
    return this.current;
  }

  /** Point the tracker at the strip currently on screen; re-pointing is cheap and idempotent. */
  observe(element: ObservedElement): void {
    if (this.element !== element) {
      this.observer?.disconnect();
      this.observer = undefined;
      this.element = element;
      if (element !== undefined) {
        const observer = this.createObserver(() => { this.refresh(); });
        if (observer !== undefined) {
          observer.observe(element);
          this.observer = observer;
        }
      }
    }
    this.refresh();
  }

  /** Recompute from the observed element, reporting only when the answer changes. */
  refresh(): void {
    const next = horizontalScrollEdges(this.element);
    if (next.left === this.current.left && next.right === this.current.right) return;
    this.current = next;
    this.onChange();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.element = undefined;
    this.current = NO_SCROLL_EDGES;
  }
}
