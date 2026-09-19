import { describe, expect, it } from "vitest";
import { offersReply, replyMessage, supervisorRequest, supervisorTitle } from "./supervisorRequest";

const payload = {
  requestId: "r1",
  runId: "run-1",
  agent: "design-reviewer-d",
  childTarget: "subagent-design-reviewer-d-1",
  reason: "question",
  expectsReply: true,
};

describe("supervisorRequest", () => {
  it("reads the run's own identity out of the frame", () => {
    expect(supervisorRequest(payload)).toEqual({
      requestId: "r1",
      runId: "run-1",
      agent: "design-reviewer-d",
      childTarget: "subagent-design-reviewer-d-1",
      reason: "question",
      expectsReply: true,
    });
  });

  it("does not invent a reason it was not given", () => {
    expect(supervisorRequest({}).reason).toBe("unknown");
    expect(supervisorTitle(supervisorRequest({}))).toBe("Message from a subagent");
  });

  it("offers a reply only when the child waits for one", () => {
    expect(offersReply(supervisorRequest(payload))).toBe(true);
    expect(offersReply(supervisorRequest({ ...payload, expectsReply: false }))).toBe(false);
    expect(offersReply(supervisorRequest({}))).toBe(false);
  });

  it("names the child and its run in the message the session receives", () => {
    expect(replyMessage(supervisorRequest(payload), "  go ahead  "))
      .toBe("Reply to subagent-design-reviewer-d-1 (run run-1): go ahead");
  });

  it("still addresses a child whose target is unknown", () => {
    expect(replyMessage(supervisorRequest({ agent: "reviewer" }), "stop")).toBe("Reply to reviewer: stop");
    expect(replyMessage(supervisorRequest({}), "stop")).toBe("Reply to the subagent: stop");
  });
});
