// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- review repro fixture: stubs reach into private runtime shapes; rewritten as a permanent test when its phase removes it.fails */
import { html as litHtml, render as litRender, svg as litSvg, type TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginActivationContext, WorkspacePanelContext, WorkspacePanelContribution } from "@gang-of-beads/pi-web/plugin-api";
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
  readonly context: WorkspacePanelContext;
  draw: () => void;
  setSessionCwd(cwd: string): void;
}

function harnessFor(section: WorkspacePanelContribution, sessionCwd: string): Harness {
  const container = document.createElement("div");
  document.body.append(container);
  const state = { selectedSession: { id: "s", cwd: sessionCwd } };
  const context = {
    machine: { id: "m", name: "m" },
    workspace: { id: "w", projectId: "p", path: WORKSPACE, label: "w", isMain: true },
    state,
    host: { requestRender: () => { harness.draw(); }, workspacePanelFullscreen: () => false, setWorkspacePanelFullscreen: () => undefined },
  } as unknown as WorkspacePanelContext;
  const harness: Harness = {
    container,
    context,
    draw: () => { litRender(section.render(context), container); },
    setSessionCwd: (cwd) => { Reflect.set(state.selectedSession, "cwd", cwd); },
  };
  return harness;
}

function sectionOf(callOperation: (operation: string, input: unknown) => Promise<unknown>): WorkspacePanelContribution {
  const context = { apiVersion: 2, pluginId: "goals", runtimePluginId: "goals", html: litHtml, svg: litSvg, callOperation } as unknown as PluginActivationContext;
  const section = plugin.activate(context).contributions.workspacePanels?.[0];
  if (section === undefined) throw new Error("the goals plugin contributes no page");
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
  /**
   * The drawer drew the section even while folded, so its count filled in by itself. A page is
   * drawn only when opened, and a Go to entry that waited for that showed "Goals" with no count
   * over a workspace with open tasks. The entry asks for the reading itself.
   */
  it("fills the Go to count without the page being opened", async () => {
    const callOperation = vi.fn(async () => ({ goals: [goal("a")], brokenFiles: 0 }));
    const section = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");

    expect(section.badge?.(harness.context)).toBeUndefined();
    await flush();

    expect(callOperation).toHaveBeenCalledTimes(1);
    expect(section.badge?.(harness.context)).toBe(2);
    expect(section.summary?.(harness.context)).toBe("0/2 tasks");
    expect(callOperation).toHaveBeenCalledTimes(1);
  });

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

  /**
   * Owner, 2026-09-30: "就说没有goal啊". A workspace with no goals says so and keeps its refresh; the
   * section used to leave the drawer, and nothing read it again, so a goal created later in the
   * same session never appeared.
   */
  it("says there are no goals, and keeps its refresh", async () => {
    const callOperation = vi.fn(async () => ({ goals: [], brokenFiles: 0 }));
    const section = sectionOf(callOperation);
    const harness = harnessFor(section, "/w/session-a");
    harness.draw();
    await flush();

    expect({
      text: await shownText(harness.container),
      refresh: harness.container.querySelector("pi-web-goals-section")?.shadowRoot?.querySelector("button.refresh") instanceof HTMLButtonElement,
    }).toEqual({ text: expect.stringContaining("No goals in this workspace.") as unknown, refresh: true });
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
