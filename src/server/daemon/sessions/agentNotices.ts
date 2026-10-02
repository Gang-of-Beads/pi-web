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
 * close), so every such clear goes through `clearLanesKeepingNotices`.
 */
export const AGENT_NOTICE_DELIVERY = { triggerTurn: true, deliverAs: "steer" } as const;

/** What of a pi session this module reads and writes. */
export interface NoticeLanes {
  agent: object;
  clearQueue(): { steering: string[]; followUp: string[] };
  sendCustomMessage(message: { customType: string; content: string; display: boolean; details?: unknown }, options?: { triggerTurn?: boolean }): Promise<void>;
}

/** A custom message waiting in agent-core's queues, as the daemon sent it. */
export interface QueuedNotice {
  customType: string;
  content: string;
  display: boolean;
  details: unknown;
}

const AGENT_QUEUES = ["steeringQueue", "followUpQueue"] as const;

/** The custom messages waiting in agent-core's queues, oldest first, steering before follow-up. */
export function queuedNotices(session: Pick<NoticeLanes, "agent">): QueuedNotice[] {
  return AGENT_QUEUES.flatMap((name) => queueMessages(Reflect.get(session.agent, name)).flatMap((message) => {
    const notice = asNotice(message);
    return notice === undefined ? [] : [notice];
  }));
}

/** Empty pi's lanes as `clearQueue()` does, and put PI WEB's notices back into the steering queue. */
export function clearLanesKeepingNotices(session: NoticeLanes): { steering: string[]; followUp: string[] } {
  const notices = AGENT_QUEUES.flatMap((name) => queueMessages(Reflect.get(session.agent, name)).filter((message) => asNotice(message) !== undefined));
  const lanes = session.clearQueue();
  const steer: unknown = Reflect.get(session.agent, "steer");
  if (typeof steer === "function") for (const message of notices) Reflect.apply(steer, session.agent, [message]);
  return lanes;
}

/**
 * Write the notices still waiting into the transcript without starting a run:
 * after a Stop, or before the runtime closes. The agent reads them with its
 * next turn, and nothing is lost when no run comes to take them from the queue.
 */
export async function commitQueuedNotices(session: NoticeLanes): Promise<void> {
  const notices = queuedNotices(session);
  if (notices.length === 0) return;
  session.clearQueue();
  for (const notice of notices) await session.sendCustomMessage(notice, { triggerTurn: false });
}

function queueMessages(queue: unknown): unknown[] {
  const messages: unknown = typeof queue === "object" && queue !== null ? Reflect.get(queue, "messages") : undefined;
  return Array.isArray(messages) ? messages : [];
}

function asNotice(message: unknown): QueuedNotice | undefined {
  if (typeof message !== "object" || message === null || Reflect.get(message, "role") !== "custom") return undefined;
  const customType: unknown = Reflect.get(message, "customType");
  const content: unknown = Reflect.get(message, "content");
  const display: unknown = Reflect.get(message, "display");
  if (typeof customType !== "string" || typeof content !== "string" || typeof display !== "boolean") return undefined;
  return { customType, content, display, details: Reflect.get(message, "details") };
}
