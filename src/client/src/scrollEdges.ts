export interface ScrollEdgeMetrics {
  readonly scrollLeft: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

export interface ScrollEdges {
  readonly left: boolean;
  readonly right: boolean;
}

export const NO_SCROLL_EDGES: ScrollEdges = { left: false, right: false };

/** Sub-pixel layout leaves scroll room on rows that actually fit. */
const EDGE_THRESHOLD_PX = 1;

export function horizontalScrollEdges(metrics: ScrollEdgeMetrics | undefined): ScrollEdges {
  if (metrics === undefined) return NO_SCROLL_EDGES;
  const maxScrollLeft = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
  return {
    left: metrics.scrollLeft > EDGE_THRESHOLD_PX,
    right: maxScrollLeft - metrics.scrollLeft > EDGE_THRESHOLD_PX,
  };
}

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

/** Tracks edges across both scrolling and resizing: narrowing hides a tab without any scroll. */
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
