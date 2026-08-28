import { describe, expect, it } from "vitest";
import { HttpError } from "./api/http";
import { RetiredBy } from "./notice";
import { errorNoticePatch } from "./errorNotice";

/**
 * Every controller reports a failure the same way: `setState({ error: ... })`,
 * built with `String(error)` at 53 call sites across six files. Two things go
 * wrong there and both reached the reader.
 *
 * The words: `String(error)` on an HttpError whose message is empty - which is
 * every HTTP/2 response whose body carried no error field, because statusText
 * is always "" over HTTP/2 - yields the bare class name "HttpError".
 *
 * The lifetime: `errorRetiredBy` was introduced so a transport complaint could
 * withdraw itself once the server answered, but nothing ever set it, so it kept
 * its initial `reader` value and the automatic withdrawal never ran. The banner
 * could only be dismissed by hand.
 *
 * Normalizing the patch in one place fixes both for every call site at once,
 * including ones written later.
 */
describe("the patch that puts a failure on screen", () => {
  it("says what failed instead of leaking the error class name", () => {
    const patch = errorNoticePatch(new HttpError("", 502));

    expect(patch.error).not.toBe("HttpError");
    expect(patch.error).toContain("502");
  });

  it("keeps the words the server sent", () => {
    expect(errorNoticePatch(new HttpError("Workspace is locked", 409)).error).toBe("Workspace is locked");
  });

  it("refuses to show a stringified object", () => {
    expect(errorNoticePatch({ unexpected: true }).error).not.toContain("[object");
  });

  /**
   * The reason the banner outlived the failure: a transport complaint has to
   * carry the fact that a reply disproves it, or the code that withdraws it
   * returns early forever.
   */
  it("lets a reply withdraw a transport failure", () => {
    expect(errorNoticePatch(new HttpError("", 502)).errorRetiredBy).toBe(RetiredBy.reply);
  });

  /**
   * A rename that failed has still failed however well the next request goes,
   * so an operation failure stays until the reader dismisses it.
   */
  it("leaves an operation failure to the reader", () => {
    expect(errorNoticePatch(new Error("Rename failed")).errorRetiredBy).toBe(RetiredBy.reader);
  });

  it("carries both fields so neither can be set without the other", () => {
    expect(Object.keys(errorNoticePatch(new Error("x"))).sort()).toEqual(["error", "errorRetiredBy"]);
  });
});
