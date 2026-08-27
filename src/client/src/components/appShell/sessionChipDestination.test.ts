import { describe, expect, it } from "vitest";
import { sessionChipDestination } from "./sessionChipDestination";

describe("where the session breadcrumb takes you", () => {
  /**
   * Opening Goals, Files or a terminal left no way back. The breadcrumb said
   * which session you were in, but pressing it listed the other sessions
   * instead of returning to the one it named, so the only way back to the
   * conversation was to keep cycling views until it came round again.
   *
   * A breadcrumb goes to what it names. It names the session, so when the
   * session's conversation is not what you are looking at, that is where it
   * goes; from the conversation itself there is nowhere closer to go, so it
   * offers the other sessions instead.
   */
  it("returns to the conversation from any other view", () => {
    expect(sessionChipDestination("core:workspace.files")).toBe("conversation");
    expect(sessionChipDestination("core:workspace.terminal")).toBe("conversation");
    expect(sessionChipDestination("navigation")).toBe("conversation");
  });

  it("offers the other sessions once you are in the conversation", () => {
    expect(sessionChipDestination("chat")).toBe("sessions");
  });
});
