import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../../api";
import { compactTitle } from "./AppNavigationPanel";

const session: SessionInfo = { id: "s1", cwd: "/repo", path: "/sessions/s1.jsonl", name: "opus-b", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:00.000Z", messageCount: 3, firstMessage: "hello" };

describe("compactTitle", () => {
  it("names the tool page on screen before the session, and the list when neither", () => {
    expect(compactTitle("Git", session)).toBe("Git");
    expect(compactTitle("Git", undefined)).toBe("Git");
    expect(compactTitle("", session)).toBe("opus-b");
    expect(compactTitle("", undefined)).toBe("Sessions");
  });
});
