/**
 * PI WEB's own messages for the agent: the answers to a question card and the
 * notice that a subsession finished (B26, state-diagram D2 "An answer is a
 * message").
 *
 * They travel as custom messages through pi's steering queue, so a running
 * agent reads them at the next injection point with the reader's own
 * messages. They used to go to the follow-up queue, which waits until the
 * agent has no work left: four answers waited 9.5 to 26.7 minutes, unseen
 * (measured 2026-09-30).
 *
 * pi's lanes hold only the reader's text; these sit in agent-core's queues
 * beside them, where `clearQueue()` drops them too. The daemon empties pi's
 * lanes to take the reader's messages back (recall, take-back, Stop, Clear,
 * close), so every such clear goes through `clearLanesKeepingNotices`. Only
 * the custom types the daemon itself sends are its notices: another
 * extension's custom message is left to pi, as before.
 */
export const AGENT_NOTICE_DELIVERY = { triggerTurn: true, deliverAs: "steer" } as const;

/** What of a pi session this module reads and writes. */
export interface NoticeLanes {
  agent: object;
  clearQueue(): { steering: string[]; followUp: string[] };
  sendCustomMessage(message: { customType: string; content: string; display: boolean; details?: unknown }, options?: { triggerTurn?: boolean }): Promise<void>;
}

/** A notice waiting in agent-core's queues, as the daemon sent it. */
export interface QueuedNotice {
  customType: string;
  content: string;
  display: boolean;
  details: unknown;
}

const AGENT_QUEUES = ["steeringQueue", "followUpQueue"] as const;

/** Reads and empties PI WEB's notices in a session's queues, given the custom types the daemon sends. */
export class AgentNotices {
  constructor(private readonly types: ReadonlySet<string>) {}

  /** The notices waiting, oldest first, steering before follow-up. */
  queued(session: Pick<NoticeLanes, "agent">): QueuedNotice[] {
    return this.waiting(session).map(({ notice }) => notice);
  }

  /** Empty pi's lanes as `clearQueue()` does, and put the notices back into the steering queue. */
  clearLanesKeepingNotices(session: NoticeLanes): { steering: string[]; followUp: string[] } {
    const kept = this.waiting(session).map(({ message }) => message);
    const lanes = session.clearQueue();
    const steer: unknown = Reflect.get(session.agent, "steer");
    if (typeof steer === "function") for (const message of kept) Reflect.apply(steer, session.agent, [message]);
    return lanes;
  }

  /**
   * Write the notices still waiting into the transcript without starting a
   * run: after a Stop, or before the runtime closes. The agent reads them with
   * its next turn, and nothing is lost when no run comes to take them. Only
   * the notices leave the queues: a reader's message steered while the Stop
   * was settling stays where it is, for the take-back to return (review of
   * 4a1bdfd7).
   */
  async commit(session: NoticeLanes): Promise<void> {
    const notices = this.queued(session);
    if (notices.length === 0) return;
    for (const name of AGENT_QUEUES) {
      const queue: unknown = Reflect.get(session.agent, name);
      if (typeof queue === "object" && queue !== null) Reflect.set(queue, "messages", queueMessages(queue).filter((message) => this.asNotice(message) === undefined));
    }
    for (const notice of notices) await session.sendCustomMessage(notice, { triggerTurn: false });
  }

  private waiting(session: Pick<NoticeLanes, "agent">): { message: unknown; notice: QueuedNotice }[] {
    return AGENT_QUEUES.flatMap((name) => queueMessages(Reflect.get(session.agent, name)).flatMap((message) => {
      const notice = this.asNotice(message);
      return notice === undefined ? [] : [{ message, notice }];
    }));
  }

  private asNotice(message: unknown): QueuedNotice | undefined {
    if (typeof message !== "object" || message === null || Reflect.get(message, "role") !== "custom") return undefined;
    const customType: unknown = Reflect.get(message, "customType");
    const content: unknown = Reflect.get(message, "content");
    const display: unknown = Reflect.get(message, "display");
    if (typeof customType !== "string" || !this.types.has(customType) || typeof content !== "string" || typeof display !== "boolean") return undefined;
    return { customType, content, display, details: Reflect.get(message, "details") };
  }
}

function queueMessages(queue: unknown): unknown[] {
  const messages: unknown = typeof queue === "object" && queue !== null ? Reflect.get(queue, "messages") : undefined;
  return Array.isArray(messages) ? messages : [];
}
