import { describe, expect, it } from "vitest";
import { clearLanesKeepingNotices, commitQueuedNotices, queuedNotices, type NoticeLanes } from "./agentNotices.js";

const answer = { role: "custom", customType: "pi-web.ask.answers", content: "The user submitted answers.", display: true, details: { askId: "ask-1" }, timestamp: 1 };
const subsession = { role: "custom", customType: "pi-web.subsession", content: "child finished", display: true, details: { sessionId: "child" }, timestamp: 2 };
const userMessage = { role: "user", content: [{ type: "text", text: "and use Postgres" }], timestamp: 3 };

/** agent-core's two queues and pi's text lanes, as the SDK keeps them. */
function fakeLanes(steering: unknown[], followUp: unknown[] = []) {
  const agent = {
    steeringQueue: { messages: [...steering] },
    followUpQueue: { messages: [...followUp] },
    steer(message: unknown) { this.steeringQueue.messages.push(message); },
  };
  const appended: { message: unknown; options: unknown }[] = [];
  const session: NoticeLanes = {
    agent,
    clearQueue: () => {
      agent.steeringQueue.messages = [];
      agent.followUpQueue.messages = [];
      return { steering: ["and use Postgres"], followUp: [] };
    },
    sendCustomMessage: (message, options) => {
      appended.push({ message, options });
      return Promise.resolve();
    },
  };
  return { agent, session, appended };
}

describe("PI WEB's notices in pi's queues (B26)", () => {
  it("reads the custom messages waiting in either queue, oldest first, and nothing else", () => {
    const { session } = fakeLanes([userMessage, answer], [subsession]);

    expect(queuedNotices(session).map((notice) => notice.customType)).toEqual(["pi-web.ask.answers", "pi-web.subsession"]);
  });

  it("empties pi's lanes and keeps the notices in the steering queue", () => {
    const { agent, session } = fakeLanes([userMessage, answer], [subsession]);

    const lanes = clearLanesKeepingNotices(session);

    expect({ lanes, steering: agent.steeringQueue.messages, followUp: agent.followUpQueue.messages })
      .toEqual({ lanes: { steering: ["and use Postgres"], followUp: [] }, steering: [answer, subsession], followUp: [] });
  });

  it("writes the waiting notices into the transcript without starting a run", async () => {
    const { agent, session, appended } = fakeLanes([answer]);

    await commitQueuedNotices(session);

    expect({ queued: agent.steeringQueue.messages, appended }).toEqual({
      queued: [],
      appended: [{ message: { customType: "pi-web.ask.answers", content: "The user submitted answers.", display: true, details: { askId: "ask-1" } }, options: { triggerTurn: false } }],
    });
  });

  it("leaves pi alone when no notice waits", async () => {
    const { session, appended } = fakeLanes([userMessage]);
    let cleared = 0;
    const counting: NoticeLanes = { ...session, clearQueue: () => { cleared += 1; return session.clearQueue(); } };

    await commitQueuedNotices(counting);

    expect({ cleared, appended }).toEqual({ cleared: 0, appended: [] });
  });
});
