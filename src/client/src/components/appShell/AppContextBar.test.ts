import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Machine } from "../../api";
import { AppContextBar, shouldShowMachineContext } from "./AppContextBar";

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
