// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { restoreOpenedUnnamedSession } from "./PiWebApp";

/**
 * D8: a workspace link on the desktop opened the latest session while the URL kept naming only the
 * workspace, so the URL did not describe the chat on screen and a reload after a newer session
 * appeared opened a different one.
 */
describe("whether a restore names the session it opened", () => {
  it("names one the route did not name, and leaves the rest", () => {
    const cases: [string, string | undefined, string | undefined, boolean][] = [
      ["a workspace link that opened the latest session", undefined, "latest", true],
      ["a workspace link with an empty session parameter", "", "latest", true],
      ["a link that named the session it opened", "named", "named", false],
      ["a workspace link that opened nothing", undefined, undefined, false],
      ["a workspace link that opened nothing, by an empty id", undefined, "", false],
    ];

    expect(cases.map(([name, routed, shown]) => [name, restoreOpenedUnnamedSession({ sessionId: routed }, shown)])).toEqual(cases.map(([name, , , names]) => [name, names]));
  });
});
