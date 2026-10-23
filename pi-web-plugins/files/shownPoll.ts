/** How often Files re-reads its tree while someone looks at it: Git's status cadence. */
export const FILES_POLL_INTERVAL_MS = 8_000;

type ShownPollState = "stopped" | "hidden" | "shown";

/**
 * Re-reads a page every few seconds while it is shown, and at once when it is
 * shown again.
 *
 * The workspace watcher refreshes Files when a file changes, but it is a
 * hint: it can drop events and watches only the directories of sessions the
 * daemon holds open. The owner asked for the page to refresh by itself
 * (2026-10-02), on the terms Git's status poll already keeps (state-diagram
 * D5, "Workspace pages stay fresh while someone looks"). Whether the page is
 * shown is the host's `host.shown()` (r151), which already counts the tab,
 * the phone's chat and a covering modal; a host that cannot say counts as
 * shown: one read too many, never one too few. Once stopped, a late report
 * starts nothing.
 */
export class ShownPoll {
  private timer: ReturnType<typeof setInterval> | undefined;
  private state: ShownPollState = "stopped";

  constructor(private readonly read: () => void) {}

  /** Start as the host says the page is now; the page reads on its own when it opens. */
  start(shown: boolean): void {
    this.stopTimer();
    this.state = shown ? "shown" : "hidden";
    if (shown) this.startTimer();
  }

  stop(): void {
    this.state = "stopped";
    this.stopTimer();
  }

  /** Whether the page is shown. Coming back reads at once; going away stops the ticks. */
  reportShown(shown: boolean): void {
    const next: ShownPollState = shown ? "shown" : "hidden";
    if (this.state === "stopped" || this.state === next) return;
    this.state = next;
    if (!shown) {
      this.stopTimer();
      return;
    }
    this.read();
    this.startTimer();
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => { this.read(); }, FILES_POLL_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
