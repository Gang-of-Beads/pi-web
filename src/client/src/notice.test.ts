import { describe, expect, it } from "vitest";
import { HttpError } from "./api/http";
import { RequestTimeoutError } from "./api/requestDeadline";
import { NO_NOTICE, noticeForReader, noticeFromError, noticeFromTransport } from "./notice";

describe("what retires a notice", () => {
  /**
   * A notice that says the server could not be reached is disproved the moment
   * the server answers, whatever words it used. Deciding that afterwards by
   * matching the words against a list meant anything the list had not met -
   * "HttpError" among them - stayed on screen while the session replied
   * normally, with the dismiss button as the only way out.
   */
  it("retires a transport notice when the server answers", () => {
    expect(retiresOnReply(noticeFromTransport("HttpError"))).toBe(true);
    expect(retiresOnReply(noticeFromTransport("Failed to fetch"))).toBe(true);
  });

  /**
   * A notice about one operation is not disproved by an unrelated success: a
   * rename that failed has still failed, however well the next request goes.
   */
  it("leaves a notice about one operation to the reader", () => {
    expect(retiresOnReply(noticeForReader("Rename failed"))).toBe(false);
  });

  it("has nothing to retire when nothing is shown", () => {
    expect(retiresOnReply(NO_NOTICE)).toBe(false);
  });
});

describe("a notice made from a thrown error", () => {
  /**
   * An HttpError is by construction a request that did not get through, so the
   * next request that does get through retires it. Anything else is about the
   * operation, not the connection.
   */
  it("leaves an HttpError to the reader: an HTTP status is an answer, not silence", () => {
    expect(retiresOnReply(noticeFromError(new HttpError("Bad Gateway", 502)))).toBe(false);
  });

  /**
   * A transport-shaped body that names its machine is a transport claim about
   * that machine - not a page claim any other machine's success may erase.
   * The gateway's 502/504 answers are exactly this shape; the scope the
   * producer chose was once dropped by branch order before the classification
   * ever read it.
   */
  it("scopes a transport-shaped HttpError that names its machine", () => {
    const notice = noticeFromError(new HttpError("Remote machine unavailable (connect ECONNREFUSED 127.0.0.1:7001)", 502, "remote-a"));
    expect(retiresOnReply(notice)).toBe(true);
    expect(notice.machineId).toBe("remote-a");
  });

  it("keeps reader retirement for an HttpError whose body carries a machineId but speaks of an operation", () => {
    const notice = noticeFromError(new HttpError("Rename failed", 500, "remote-a"));
    expect(retiresOnReply(notice)).toBe(false);
  });

  it("retires a link failure on the next reply", () => {
    expect(retiresOnReply(noticeFromError(new TypeError("Failed to fetch")))).toBe(true);
  });

  /**
   * A request deadline is the same claim shape as an HttpError - "the server
   * did not answer" - so later answers disprove it too. Measured live: a
   * remote machine answered /status after 30.007s while the browser deadline
   * fired at 30.000s, and the timeout banner outlived a session that kept
   * replying, because a plain Error landed on the reader lifetime.
   */
  it("retires a request timeout on the next reply", () => {
    expect(retiresOnReply(noticeFromError(new RequestTimeoutError("/status", 30_000)))).toBe(true);
  });

  it("leaves other failures to the reader", () => {
    expect(retiresOnReply(noticeFromError(new Error("Rename failed")))).toBe(false);
  });
});

describe("a failure that never said what went wrong", () => {
  /**
   * Over HTTP/2 `response.statusText` is always the empty string, so a body
   * carrying no error field builds an HttpError whose message is "". An Error
   * with a name and no message stringifies to just its name, which is where a
   * red banner reading the bare word "HttpError" came from - nobody wrote that
   * text, it is the class name leaking through `String(error)`.
   *
   * A reader cannot act on a class name, so the notice has to say what failed
   * in words a reader can use.
   */
  it("says what failed instead of showing the error class name", () => {
    const notice = noticeFromError(new HttpError("", 502));

    expect(notice.text).not.toBe("HttpError");
    expect(notice.text).not.toBe("");
    expect(notice.text).toContain("502");
  });

  it("names the status even when the body is silent for other codes", () => {
    expect(noticeFromError(new HttpError("", 503)).text).toContain("503");
  });

  /**
   * A thrown non-Error stringifies to things like "[object Object]", which is
   * the same failure in a different costume.
   */
  it("refuses to show a stringified object as a message", () => {
    const notice = noticeFromError({ unexpected: true });

    expect(notice.text).not.toContain("[object");
    expect(notice.text).not.toBe("");
  });

  it("keeps a real message when the server sent one", () => {
    expect(noticeFromError(new HttpError("Workspace is locked", 409)).text).toBe("Workspace is locked");
  });

  /**
   * The empty-text guard in retiresOnReply meant a notice with no words could
   * never retire itself. Now that a notice always carries words, a transport
   * failure retires on the next reply whatever the server said.
   */
  it("still hands the undescribed failure to the reader, described by its status", () => {
    expect(retiresOnReply(noticeFromError(new HttpError("", 502)))).toBe(false);
    expect(noticeFromError(new HttpError("", 502)).text).toBe("The request failed (502)");
  });
});

function retiresOnReply(notice: { text: string; retiredBy: string }): boolean {
  return notice.text !== "" && notice.retiredBy === "reply";
}
