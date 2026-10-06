import type { SessionUiEvent } from "../../shared/apiTypes";

/**
 * Extension notices that arrive while the transcript's tail is trimmed, the reader parked behind
 * the "newer" chip. The transcript cannot append them after a gap the reader has not seen, and the
 * daemon keeps no notice, so the newer page used to rebuild without them: a warning or an error the
 * docs promise is kept would vanish (review triage, extension UI steps 2-3). They are held for the
 * session they arrived for and appended, in order, once the newer page reaches the tail.
 */
export class ParkedNotices {
  private sessionKey: string | undefined;
  private events: SessionUiEvent[] = [];

  /** Holds `event` when it is a notice; anything else is the chip's business. */
  park(sessionKey: string, event: SessionUiEvent): void {
    if (event.type !== "extension.ui" || event.kind !== "notify") return;
    if (sessionKey !== this.sessionKey) {
      this.sessionKey = sessionKey;
      this.events = [];
    }
    this.events.push(event);
  }

  /** The notices held for `sessionKey`, oldest first; the hold is empty afterwards. */
  take(sessionKey: string): readonly SessionUiEvent[] {
    const events = sessionKey === this.sessionKey ? this.events : [];
    this.sessionKey = undefined;
    this.events = [];
    return events;
  }
}
