import { describe, expect, it } from "vitest";
import { defaultRouteView } from "./appShellController";

describe("defaultRouteView", () => {
  it("opens the conversation a link names, on any layout", () => {
    // A shared link that names a session has already said what to show. The
    // narrow layout used to ignore that and open the session list, leaving the
    // session it named one tap away - while the same link opened the
    // conversation directly on a wide layout.
    expect(defaultRouteView(true, { sessionId: "01a0" })).toBe("chat");
    expect(defaultRouteView(false, { sessionId: "01a0" })).toBe("chat");
  });

  it("opens navigation on a narrow layout when the link names no session", () => {
    expect(defaultRouteView(true, {})).toBe("navigation");
    expect(defaultRouteView(true, { sessionId: "" })).toBe("navigation");
    expect(defaultRouteView(true, { sessionId: undefined })).toBe("navigation");
  });

  it("opens the chat on a wide layout regardless", () => {
    expect(defaultRouteView(false, {})).toBe("chat");
  });
});
