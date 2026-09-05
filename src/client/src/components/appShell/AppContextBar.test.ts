import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../../api";
import { AppContextBar, sessionContextLabel } from "./AppContextBar";

describe("what the resident row calls the session", () => {
  function session(patch: Partial<SessionInfo> = {}): SessionInfo {
    return {
      id: "019f22c5-d53e-7489-997f-fce17c4dc82f",
      cwd: "/repo",
      path: "/repo/.pi/session.jsonl",
      created: "2026-08-28T10:00:00.000Z",
      modified: "2026-08-28T10:00:00.000Z",
      messageCount: 0,
      firstMessage: "",
      ...patch,
    };
  }

  /**
   * The bar carried its own copy of the fallback chain, so a session nobody
   * had spoken to yet was announced as "Session: 7c4dc82f. Open session
   * selection." - the reader was told the name of the thing in front of them
   * was a hexadecimal id.
   */
  it("names a session that has not been spoken to yet in words", () => {
    const label = sessionContextLabel(session());

    expect(label).toBe("New session");
    expect(label).not.toContain("7c4dc82f");
  });

  it("still says plainly when nothing is selected", () => {
    expect(sessionContextLabel(undefined)).toBe("No session");
  });

  it("prefers the words the session already has", () => {
    expect(sessionContextLabel(session({ name: "Ship the release" }))).toBe("Ship the release");
    expect(sessionContextLabel(session({ firstMessage: "Fix the test" }))).toBe("Fix the test");
  });
});

describe("the resident row stays minimal and tappable", () => {
  /**
   * The row once carried a scrolling chip strip, an inline rename, and four
   * floating action buttons; at 393px it was exactly full and the session name
   * lost the room. Everything but the toggle, the name, and the working
   * indicator moved to the collapsible panel.
   */
  it("keeps no horizontal-scroll chip strip and no floating action layer", () => {
    const sheet = String(AppContextBar.styles);

    expect(sheet).not.toContain("overflow-x: auto");
    expect(sheet).not.toContain("context-actions");
    expect(sheet).not.toContain("context-items");
  });

  it("keeps every control at the project touch floor", () => {
    const sheet = String(AppContextBar.styles);

    expect(sheet).toMatch(/\.panel-toggle\s*\{[^}]*width:\s*44px/u);
    expect(sheet).toMatch(/\.session-title\s*\{[^}]*min-height:\s*44px/u);
    expect(sheet).toMatch(/\.working\s*\{[^}]*min-height:\s*44px/u);
  });
});
