import { describe, expect, it } from "vitest";
import { answeredReply, offersReply, replyMessage, supervisorRequest, supervisorTitle } from "./supervisorRequest";

const payload = {
  requestId: "r1",
  runId: "run-1",
  agent: "design-reviewer-d",
  childTarget: "subagent-design-reviewer-d-1",
  reason: "need_decision",
  expectsReply: true,
  requestBody: "OK to edit both config files (3 lines each)?",
};

describe("supervisorRequest", () => {
  it("reads the run's own identity out of the frame", () => {
    expect(supervisorRequest(payload)).toEqual({
      requestId: "r1",
      runId: "run-1",
      agent: "design-reviewer-d",
      childTarget: "subagent-design-reviewer-d-1",
      reason: "need_decision",
      expectsReply: true,
      body: "OK to edit both config files (3 lines each)?",
    });
  });

  it("names every reason pi-subagents sends, so a decision request never reads as a bare message", () => {
    const titles = ["need_decision", "interview_request", "progress_update"].map((reason) => supervisorTitle(supervisorRequest({ agent: "delegate", reason })));
    expect(titles).toEqual(["Decision request from delegate", "Interview request from delegate", "Progress update from delegate"]);
  });

  it("carries what the child asked, from the field pi-subagents writes it to", () => {
    expect(supervisorRequest({ requestBody: "OK to edit?" }).body).toBe("OK to edit?");
    expect(supervisorRequest({}).body).toBeUndefined();
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

  it("names the child, its run and the request in the message the session receives", () => {
    expect(replyMessage(supervisorRequest(payload), "  go ahead  "))
      .toBe("Reply to subagent-design-reviewer-d-1 (run run-1, request r1): go ahead");
  });

  it("does not take a reply to a later request from the same run as an answer to an earlier one", () => {
    const first = supervisorRequest(payload);
    const second = supervisorRequest({ ...payload, requestId: "r2" });

    expect({ first: answeredReply(first, [replyMessage(second, "no")]), second: answeredReply(second, [replyMessage(second, "no")]) }).toEqual({ first: undefined, second: "no" });
  });

  it("still addresses a child whose target is unknown", () => {
    expect(replyMessage(supervisorRequest({ agent: "reviewer" }), "stop")).toBe("Reply to reviewer: stop");
    expect(replyMessage(supervisorRequest({}), "stop")).toBe("Reply to the subagent: stop");
  });

  it("finds the reply the reader sent to this request in what they said after it, and nothing else", () => {
    const request = supervisorRequest(payload);
    const other = supervisorRequest({ ...payload, runId: "run-2" });
    const said = ["thanks", replyMessage(other, "no"), replyMessage(request, "yes, both")];

    expect({
      answered: answeredReply(request, said),
      otherRun: answeredReply(other, said.slice(0, 2)),
      notYet: answeredReply(request, said.slice(0, 2)),
      noReplyExpected: answeredReply(supervisorRequest({ ...payload, expectsReply: false }), said),
    }).toEqual({ answered: "yes, both", otherRun: "no", notYet: undefined, noReplyExpected: undefined });
  });
});
