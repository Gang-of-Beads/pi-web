/** How often Files re-reads its tree while someone looks at it: Git's status cadence. */
export const FILES_POLL_INTERVAL_MS = 8_000;

/**
 * Re-reads a page every few seconds while it is on screen and its tab is
 * visible, and at once when it comes back on screen.
 *
 * The workspace watcher refreshes Files when a file changes, but it is a
 * hint: it can drop events and watches only the directories of sessions the
 * daemon holds open. The owner asked for the page to refresh by itself
 * (2026-10-02), on the terms Git's status poll already keeps (state-diagram
 * D5, "Workspace pages stay fresh while someone looks"). Where the page
 * cannot observe its own visibility, it counts as shown: one read too many,
 * never one too few.
 */
export class ShownPoll {
  private timer: ReturnType<typeof setInterval> | undefined;
  private observer: IntersectionObserver | undefined;
  private shown = true;

  constructor(private readonly read: () => void, private readonly intervalMs = FILES_POLL_INTERVAL_MS) {}

  start(target: Element): void {
    this.stop();
    this.shown = true;
    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver((entries) => {
        const latest = entries.at(-1);
        if (latest !== undefined) this.reportShown(latest.isIntersecting);
      });
      this.observer.observe(target);
    }
    this.startTimer();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.stopTimer();
  }

  /** Whether the page is on screen. Coming back reads at once; going away stops the ticks. */
  reportShown(shown: boolean): void {
    if (this.shown === shown) return;
    this.shown = shown;
    if (!shown) {
      this.stopTimer();
      return;
    }
    this.read();
    this.startTimer();
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => {
      if (document.visibilityState !== "hidden") this.read();
    }, this.intervalMs);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
