import { statusChanges } from "../../../shared/statusChanges.js";

/** Sessions whose last sent status a scope remembers; past it the oldest is forgotten and goes whole. */
const REMEMBERED_SESSIONS = 256;

/**
 * Which status payload each socket of one scope gets (a session's sockets, or the machine's):
 * a socket that asked for deltas and received the last status sent for the session gets what
 * changed since; any other gets the whole status. A socket is in step only with what was sent
 * to it (one skipped because it is closing is counted too, as a closing socket never gets
 * another frame), so a socket that just joined, one that missed a frame (`outOfStep`), and a
 * session this scope no longer remembers all get the whole status next. The replay ring and
 * the HTTP reads keep whole statuses; only live delivery changes.
 */
export class StatusDeltaScope {
  private readonly lastSent = new Map<string, Readonly<Record<string, unknown>>>();
  private readonly inStep = new WeakMap<object, Set<string>>();
  private readonly asked = new WeakSet();

  /** The socket's page decodes `status.changed` frames. */
  ask(socket: object): void {
    this.asked.add(socket);
  }

  /** Each socket's payload for a status sent now: its changes, or `whole`. */
  payloads(sessionId: string, status: Readonly<Record<string, unknown>>, whole: string, stamp: Readonly<Record<string, unknown>>): (socket: object) => string {
    const previous = this.lastSent.get(sessionId);
    this.remember(sessionId, status);
    let changes: string | undefined;
    return (socket) => {
      const sentPrevious = previous !== undefined && this.inStep.get(socket)?.has(sessionId) === true;
      if (this.asked.has(socket)) this.markInStep(socket, sessionId);
      if (!sentPrevious) return whole;
      changes ??= JSON.stringify({ ...statusChanges(sessionId, previous, status), ...stamp });
      return changes;
    };
  }

  /** A session's frame was not delivered to these sockets: their next status of it is whole. */
  outOfStep(sockets: Iterable<object>, sessionId: string): void {
    for (const socket of sockets) this.inStep.get(socket)?.delete(sessionId);
  }

  private remember(sessionId: string, status: Readonly<Record<string, unknown>>): void {
    this.lastSent.delete(sessionId);
    this.lastSent.set(sessionId, status);
    if (this.lastSent.size <= REMEMBERED_SESSIONS) return;
    const oldest = this.lastSent.keys().next();
    if (oldest.done !== true) this.lastSent.delete(oldest.value);
  }

  private markInStep(socket: object, sessionId: string): void {
    const sessions = this.inStep.get(socket);
    if (sessions === undefined) this.inStep.set(socket, new Set([sessionId]));
    else sessions.add(sessionId);
  }
}
