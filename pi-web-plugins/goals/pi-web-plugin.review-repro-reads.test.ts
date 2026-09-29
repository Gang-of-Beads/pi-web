// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- review repro fixture: stubs reach into private runtime shapes; rewritten as a permanent test when its phase removes it.fails */
import { html as litHtml, render as litRender, svg as litSvg, type TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawerSectionContribution, PluginActivationContext, DrawerSectionContext } from "@gang-of-beads/pi-web/plugin-api";
import type { GoalRecordSummary } from "./goalRecords.js";
import plugin from "./pi-web-plugin.js";

/**
 * The goals section is a network read keyed by a cache, and its key is what
 * decides whether a new read happens at all. Two things have to hold: the key
 * carries every fact the read depends on (goals.list takes a session cwd as
 * well as the workspace, and a narrower session cwd overlays its own goals),
 * and a read that failed may not look like a workspace with no goals.
 */

const WORKSPACE = "/w";

const goal = (id: string): GoalRecordSummary => ({
  id, objective: `goal ${id}`, status: "active", tasksTotal: 2, tasksDone: 0, updatedAt: "2026-01-01T00:00:00.000Z",
});

interface Harness {
  readonly container: HTMLElement;
  readonly context: DrawerSectionContext;
  draw: () => void;
  setSessionCwd(cwd: string): void;
}

function harnessFor(section: DrawerSectionContribution, sessionCwd: string): Harness {
  const container = document.createElement("div");
  document.body.append(container);
  const context = {
    sessionId: "s",
    machineId: "m",
    workspacePath: WORKSPACE,
    sessionCwd,
    requestUpdate: () => { harness.draw(); },
  } as unknown as DrawerSectionContext;
  const harness: Harness = {
    container,
    context,
    draw: () => { litRender(section.render(context), container); },
    setSessionCwd: (cwd) => { Reflect.set(context, "sessionCwd", cwd); },
  };
  return harness;
}

function sectionOf(callOperation: (operation: string, input: unknown) => Promise<unknown>): DrawerSectionContribution {
  const context = { apiVersion: 2, pluginId: "goals", runtimePluginId: "goals", html: litHtml, svg: litSvg, callOperation } as unknown as PluginActivationContext;
  const section = plugin.activate(context).contributions.drawerSections?.[0];
  if (section === undefined) throw new Error("the goals plugin contributes no drawer section");
  return section;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
};

/** The section draws a custom element, so its words live in that shadow root. */
async function shownText(container: HTMLElement): Promise<string> {
  await flush();
  const element = container.querySelector("pi-web-goals-section") as (HTMLElement & { updateComplete?: Promise<unknown> }) | null;
  if (element === null) return "";
  await element.updateComplete;
  return (element.shadowRoot?.textContent ?? "").replace(/\s+/gu, " ").trim();
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("the goals section read", () => {
  it("reads once per workspace and shows what it read", async () => {
    const callOperation = vi.fn(async () => ({ goals: [goal("a")], brokenFiles: 0 }));
    const section = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();
    await flush();
    expect(callOperation).toHaveBeenCalledTimes(1);
    expect(await shownText(harness.container)).toContain("goal a");
  });

  /**
   * The read's input carries the session cwd, so a different session in the
   * same workspace is a different reading. With the key on the workspace only,
   * the section shows one session's goals while the other is selected and
   * never asks again.
   */
  it("re-reads when the selected session moves inside the same workspace", async () => {
    const callOperation = vi.fn(async (_operation: string, input: unknown) => {
      const cwd = (input as { sessionCwd?: string }).sessionCwd;
      return { goals: [goal(cwd === "/w/session-b" ? "from-b" : "from-a")], brokenFiles: 0 };
    });
    const section = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();
    await flush();
    expect(await shownText(harness.container)).toContain("goal from-a");

    harness.setSessionCwd("/w/session-b");
    harness.draw();
    await flush();
    expect(callOperation).toHaveBeenCalledTimes(2);
    expect(await shownText(harness.container)).toContain("goal from-b");
  });

  /**
   * A refused read answers as an empty goal list today, which is also what a
   * workspace with no goals answers. The drawer then hides the section, so a
   * machine that could not be read looks like a workspace with nothing in it.
   */
  it("says a failed read could not be read instead of showing an empty workspace", async () => {
    const callOperation = vi.fn(async () => { throw new Error("machine down"); });
    const section = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();
    await flush();
    expect(await shownText(harness.container)).toContain("could not");
  });

  /** The drawer decides whether the section exists at all from the same cache. */
  it("keeps the failed section in the drawer instead of hiding it", async () => {
    const callOperation = vi.fn(async () => { throw new Error("machine down"); });
    const section = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();
    await flush();
    expect(section.available?.(harness.context)).toBe(true);
  });

  /** Phase 4's read identity: a refresh's answer only replaces an older one. */
  it("keeps a newer refresh's answer when an earlier read answers late", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const callOperation = vi.fn(() => new Promise<unknown>((resolve) => { answers.push(resolve); }));
    const section = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();
    const element = harness.container.querySelector("pi-web-goals-section") as (HTMLElement & { onRefresh?: () => void }) | null;
    element?.onRefresh?.();
    answers[1]?.({ goals: [goal("newer")], brokenFiles: 0 });
    await flush();
    answers[0]?.({ goals: [goal("older")], brokenFiles: 0 });
    await flush();

    expect(await shownText(harness.container)).toContain("goal newer");
  });
});
