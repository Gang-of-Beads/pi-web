import type { Unanswered } from "../sync/scopedResource";

/**
 * Whether the page can still confirm it is in step with its server (owner, 2026-10-06).
 *
 * The page sent something and nothing has come back since: no response, no stated error, no socket
 * frame. Any answer from the server resets the clock - a 500 disproves "unreachable" as much as a
 * 200 - and the row says it is trying to sync only once a request has gone unanswered for the ack
 * timeout (`TRANSIENT_GRACE_MS`, the row's grace). This is not the quiet window: that one probes
 * when nothing has arrived for a while; this one is a request the page made that got no ack, so the
 * page can no longer vouch for its cursor. The timer is the page's, about its own server; a remote
 * machine that does not answer is the server's answer and keeps its own words.
 *
 * Uploads are not watched: their request body takes as long as the file, with the link healthy.
 */
export class AckWatch {
  private readonly outstanding = new Map<number, number>();
  private nextToken = 0;
  private lastAckAt = 0;
  private failedSince: number | undefined;
  private listener: (() => void) | undefined;
  private reported: number | undefined;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Told whenever `unanswered()` may answer differently. */
  watch(listener: (() => void) | undefined): void {
    this.listener = listener;
  }

  /** A request left; the token settles it. */
  sent(): number {
    const token = this.nextToken;
    this.nextToken += 1;
    this.outstanding.set(token, this.now());
    this.changed();
    return token;
  }

  /** The server answered this request, with anything. */
  answered(token: number): void {
    this.outstanding.delete(token);
    this.heard();
  }

  /** The request got no answer: the link failed or its deadline passed. The page stays unconfirmed until something answers. */
  unanswered(token: number): void {
    const sentAt = this.outstanding.get(token);
    this.outstanding.delete(token);
    if (sentAt !== undefined && sentAt >= this.lastAckAt) this.failedSince ??= sentAt;
    this.changed();
  }

  /** The caller gave the request up; that says nothing about the server. */
  withdrawn(token: number): void {
    this.outstanding.delete(token);
    this.changed();
  }

  /** A frame or response arrived: the server is there, and the clock starts again. */
  heard(): void {
    this.lastAckAt = this.now();
    this.failedSince = undefined;
    this.changed();
  }

  /**
   * Since when the page has gone without an answer to something it sent, if it has. A request sent
   * before the latest answer does not count, nor does its failure: the answer proved the link, and a
   * request still stuck on the connection that died is left to its own deadline. Counting it kept the
   * row on after recovery whenever the page then went quiet.
   */
  waiting(): Unanswered | undefined {
    const pending = [...this.outstanding.values()].filter((sentAt) => sentAt >= this.lastAckAt);
    const oldest = pending.length === 0 ? undefined : Math.min(...pending);
    const since = oldest === undefined ? this.failedSince : this.failedSince === undefined ? oldest : Math.min(oldest, this.failedSince);
    return since === undefined ? undefined : { since, miss: { kind: "link-down" } };
  }

  private changed(): void {
    const since = this.waiting()?.since;
    if (since === this.reported) return;
    this.reported = since;
    this.listener?.();
  }
}

/** The page's one watch over its link to the server. */
export const ackWatch = new AckWatch();

/**
 * Run one request under the watch: an answer is an ack, a transport failure is not, and a request
 * the caller cancelled says nothing either way. Uploads pass through unwatched.
 */
export async function watchedFetch<T>(send: () => Promise<T>, options: { readonly upload: boolean; readonly callerAborted: () => boolean }): Promise<T> {
  if (options.upload) return send();
  const token = ackWatch.sent();
  try {
    const answer = await send();
    ackWatch.answered(token);
    return answer;
  } catch (error) {
    if (options.callerAborted()) ackWatch.withdrawn(token);
    else ackWatch.unanswered(token);
    throw error;
  }
}
