import { describe, expect, it } from "vitest";
import type { TerminalInfo } from "@gang-of-beads/pi-web/plugin-api";
import { selectFallbackTerminal, selectPreferredTerminal } from "./terminalChoice.js";

function terminal(id: string, exited = false): TerminalInfo {
  return { id, cwd: "/repo", name: id, createdAt: "now", exited };
}

describe("which terminal a panel shows", () => {
  it("prefers explicit route targets before remembered or default terminals", () => {
    const terminals = [terminal("first"), terminal("target")];

    expect(selectPreferredTerminal(terminals, { targetTerminalId: "target", latestTerminalId: "first" })?.id).toBe("target");
  });

  it("uses remembered terminals when there is no route target", () => {
    const terminals = [terminal("first"), terminal("remembered")];

    expect(selectPreferredTerminal(terminals, { latestTerminalId: "remembered" })?.id).toBe("remembered");
  });

  it("falls back to an active terminal and then any terminal", () => {
    expect(selectPreferredTerminal([terminal("exited", true), terminal("active")])?.id).toBe("active");
    expect(selectFallbackTerminal([terminal("exited", true)])?.id).toBe("exited");
  });

});
