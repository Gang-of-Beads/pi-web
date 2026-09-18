/**
 * Whether a scroller should show its thumb.
 *
 * A rail drawn at rest is chrome nobody asked for: the owner reads a permanent
 * bar down the right edge as part of the page. The thumb belongs to the
 * gesture, so it appears while the reader scrolls and retires shortly after
 * the scrolling stops. The delay is long enough that a flicked scroll does not
 * blink the thumb between frames.
 */
export const SCROLL_THUMB_LINGER_MS = 700;

export interface ScrollThumbTimers {
  setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}

export class ScrollThumbVisibility {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private visible = false;

  constructor(private readonly onChange: (visible: boolean) => void, private readonly timers: ScrollThumbTimers = defaultTimers) {}

  /** A scroll happened: show the thumb and restart its retirement. */
  noteScroll(): void {
    if (this.timer !== undefined) this.timers.clearTimer(this.timer);
    if (!this.visible) { this.visible = true; this.onChange(true); }
    this.timer = this.timers.setTimer(() => { this.timer = undefined; this.hide(); }, SCROLL_THUMB_LINGER_MS);
  }

  /** The scroller is going away; nothing should outlive it. */
  dispose(): void {
    if (this.timer !== undefined) { this.timers.clearTimer(this.timer); this.timer = undefined; }
    this.hide();
  }

  private hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.onChange(false);
  }
}

const defaultTimers: ScrollThumbTimers = {
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => { clearTimeout(timer); },
};
