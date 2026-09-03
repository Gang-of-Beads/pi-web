/**
 * The daemon's memory of prompts it has already accepted, by sender identity.
 *
 * The browser retries from its outbox with the same clientMessageId whenever a
 * response was lost - going back online, reloading mid-send. Whether the first
 * attempt arrived is exactly what the sender cannot know, so the daemon must
 * answer the repeat instead of running it twice. The queue records cannot do
 * this: they forget an id the moment the prompt is consumed, which is the
 * common case for a prompt accepted while the session was idle.
 *
 * One id is one message: the composer mints a fresh id for every send, so a
 * deliberate second "continue" carries a different id and is never swallowed.
 *
 * Process-scoped and bounded. A daemon restart forgets the ledger - the same
 * volatility as the queue it protects; making both durable is the message-sync
 * design's work.
 */
export class AcceptanceLedger {
  private readonly acceptedBySession = new Map<string, Set<string>>();

  constructor(private readonly perSessionLimit = 200) {}

  /** Whether this identity was already accepted for this session. */
  has(sessionId: string, clientMessageId: string): boolean {
    return this.acceptedBySession.get(sessionId)?.has(clientMessageId) ?? false;
  }

  /** Record an acceptance. Oldest entries fall off past the bound. */
  record(sessionId: string, clientMessageId: string): void {
    const accepted = this.acceptedBySession.get(sessionId) ?? new Set<string>();
    accepted.delete(clientMessageId);
    accepted.add(clientMessageId);
    while (accepted.size > this.perSessionLimit) {
      const oldest = accepted.values().next().value;
      if (oldest === undefined) break;
      accepted.delete(oldest);
    }
    this.acceptedBySession.set(sessionId, accepted);
  }

  /** Forget a session that no longer exists. */
  forgetSession(sessionId: string): void {
    this.acceptedBySession.delete(sessionId);
  }
}
