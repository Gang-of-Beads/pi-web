import { describe, expect, it } from "vitest";
import { HttpError } from "./api/http";
import { NO_NOTICE, noticeForReader, noticeFromError, noticeFromTransport, retiresOnReply } from "./notice";

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
  it("retires an HttpError on the next reply", () => {
    expect(retiresOnReply(noticeFromError(new HttpError("Bad Gateway", 502)))).toBe(true);
  });

  it("leaves other failures to the reader", () => {
    expect(retiresOnReply(noticeFromError(new Error("Rename failed")))).toBe(false);
  });
});
