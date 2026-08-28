import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Machine } from "../../api";
import type { SessionInfo } from "../../api";
import { AppContextBar, sessionContextLabel, shouldShowMachineContext } from "./AppContextBar";

describe("shouldShowMachineContext", () => {
  it("hides the machine crumb only before any machine is known", () => {
    expect(shouldShowMachineContext([])).toBe(false);
  });

  // The crumb is the mobile route to machine management: renaming this device
  // and adding another one live behind it, so one machine is enough to show it.
  it("shows the machine crumb as soon as a machine exists", () => {
    expect(shouldShowMachineContext([machine("local")])).toBe(true);
    expect(shouldShowMachineContext([machine("local"), machine("remote-a")])).toBe(true);
  });
});

function machine(id: string): Machine {
  return {
    id,
    name: id,
    kind: id === "local" ? "local" : "remote",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}

describe("which part of the trail gets the room on a phone", () => {
  /**
   * The header read "hxd-work-mbp / … pi…": the breadcrumb was allowed 42% of
   * the row, the round actions took their share, and the session name - the
   * one part that says which conversation this is - was left with a few
   * characters. Messages went to the wrong session because of it.
   *
   * The machine and project are usually the same across a day's work and can
   * be opened when they are needed. The session name is read every time, so on
   * a phone it gets the room and the breadcrumb yields.
   */
  it("gives the breadcrumb less than a quarter of a phone row", () => {
    const sheet = String(AppContextBar.styles);
    const narrow = sheet.slice(sheet.indexOf("@media (max-width: 640px)"));
    const width = /\.context-breadcrumb\s*\{[^}]*max-width:\s*(\d+)%/u.exec(narrow)?.[1];

    expect(Number(width)).toBeLessThanOrEqual(25);
  });
});

describe("what the location trail calls the session", () => {
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
   * selection." and offered "Rename session 7c4dc82f" - the reader was told
   * the name of the thing in front of them was a hexadecimal id.
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

describe("room for the buttons that float over the context bar", () => {
  /**
   * The buttons are absolutely positioned and the text was kept clear of them
   * by two guessed widths, 58px and 102px. Measured on a phone the three
   * buttons occupied 120px, so every label - machine, project and workspace -
   * sat underneath them and the text ran 44px past the edge of the screen.
   */
  it("keeps clear of whatever the buttons actually measure", () => {
    const sheet = readFileSync(join(process.cwd(), "src/client/src/components/appShell/AppContextBar.ts"), "utf8");

    expect(sheet).toMatch(/padding-right:\s*var\(--pi-context-actions-room/u);
    expect(sheet).not.toMatch(/padding-right:\s*58px/u);
    expect(sheet).not.toMatch(/padding-right:\s*102px/u);
  });
});
