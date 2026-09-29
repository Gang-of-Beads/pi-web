// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unused-vars -- review repro fixture: stubs reach into private runtime shapes; rewritten as a permanent test when its phase removes it.fails */
import { html as litHtml, render as litRender, svg as litSvg, type TemplateResult } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginActivationContext, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import plugin from "./pi-web-plugin.js";

/**
 * The runs panel's read is a network read rendered into a live panel, so three
 * things have to hold: an answer belongs to the read that asked (a late answer
 * may not overwrite a newer one), one read at a time (a stalled read may not be
 * multiplied by the poll), and the reading state may not outlive its read.
 *
 * The three assertions below are the ones that fail on the pre-fix code.
 */

const SESSION = "/sessions/session-a.jsonl";

function answer(agent: string): unknown {
  return { known: true, runs: [{ runId: agent, agent, status: "running", elapsedMs: 1000, startedAt: "2026-01-01T00:00:00.000Z", hasOutput: false }] };
}

interface Harness {
  readonly container: HTMLElement;
  readonly callOperation: ReturnType<typeof vi.fn>;
  readonly pending: ((value: unknown) => void)[];
  panelText(): string;
}

function harness(): Harness {
  const container = document.createElement("div");
  document.body.append(container);
  const pending: ((value: unknown) => void)[] = [];
  const callOperation = vi.fn((_operation: string, _input: unknown) => new Promise<unknown>((resolve) => { pending.push(resolve); }));
  const context = {
    apiVersion: 2,
    pluginId: "subagents",
    runtimePluginId: "subagents",
    html: litHtml,
    svg: litSvg,
    callOperation,
  } as unknown as PluginActivationContext;
  const contribution = plugin.activate(context).contributions.workspacePanels?.[0];
  if (contribution === undefined) throw new Error("the subagents plugin contributes no workspace panel");
  const panel = {
    machine: { id: "local" },
    workspace: { id: "w", projectId: "p", path: "/w" },
    state: { selectedSession: { path: SESSION } },
    host: { requestRender: () => { draw(); } },
  } as unknown as WorkspacePanelContext;
  const draw = (): void => { litRender(contribution.render(panel), container); };
  draw();
  return { container, callOperation, pending, panelText: () => (container.textContent ?? "").replace(/\s+/gu, " ").trim() };
}

const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe("the subagents panel read", () => {
  it("starts reading, then shows the answer it was given", async () => {
    const harnessed = harness();
    expect(harnessed.panelText()).toContain("Reading this session's subagents");
    harnessed.pending[0]?.(answer("first-run"));
    await settle();
    expect(harnessed.panelText()).toContain("first-run");
  });

  /**
   * The boot read and the poll's read can both be in flight. The poll asks
   * later, so its answer is newer: the boot answer landing afterwards must not
   * put the older list back on screen.
   */
  it("does not let a late answer for an older read overwrite a newer answer", async () => {
    const harnessed = harness();
    await vi.advanceTimersByTimeAsync(21_000);
    expect(harnessed.pending).toHaveLength(2);
    harnessed.pending[1]?.(answer("newer-run"));
    await settle();
    expect(harnessed.panelText()).toContain("newer-run");

    harnessed.pending[0]?.(answer("older-run"));
    await settle();
    expect(harnessed.panelText()).toContain("newer-run");
  });

  /**
   * One failed poll must not blank a list the reader is watching: the rows
   * were read for this same session, so they stay and the panel says the
   * refresh failed - the shape the background-runs plugin already uses
   * (`LIST_NOTE` in pi-web-plugins/background-runs/backgroundTaskRows.ts).
   */
  it("keeps the rows it already showed when a later read fails", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const pending: ((value: unknown) => void)[] = [];
    const rejecting: ((error: unknown) => void)[] = [];
    const callOperation = vi.fn(() => new Promise<unknown>((resolve, reject) => { pending.push(resolve); rejecting.push(reject); }));
    const context = { apiVersion: 2, pluginId: "subagents", runtimePluginId: "subagents", html: litHtml, svg: litSvg, callOperation } as unknown as PluginActivationContext;
    const contribution = plugin.activate(context).contributions.workspacePanels?.[0];
    if (contribution === undefined) throw new Error("no panel");
    const panel = { machine: { id: "local" }, workspace: { id: "w", projectId: "p", path: "/w" }, state: { selectedSession: { path: SESSION } }, host: { requestRender: () => { litRender(contribution.render(panel), container); } } } as unknown as WorkspacePanelContext;
    litRender(contribution.render(panel), container);
    pending[0]?.(answer("kept-run"));
    await settle();
    expect((container.textContent ?? "")).toContain("kept-run");

    await vi.advanceTimersByTimeAsync(3000);
    rejecting[1]?.(new Error("link died"));
    await settle();
    expect((container.textContent ?? "")).toContain("kept-run");
  });

  /**
   * A poll tick must not add a second read of the same thing while the first
   * is still unanswered; the shell already owns a one-read-at-a-time helper
   * for exactly this (src/client/src/sessionActivityPolling.ts).
   */
  it("keeps one read in flight for the same session", async () => {
    const harnessed = harness();
    await vi.advanceTimersByTimeAsync(9000);
    expect(harnessed.callOperation).toHaveBeenCalledTimes(1);
  });

  it("keeps polling after the panel stops being rendered, and pins the last session it drew", async () => {
    const harnessed = harness();
    for (let tick = 0; tick < 4; tick += 1) {
      for (const resolve of harnessed.pending.splice(0)) resolve(answer("run"));
      await vi.advanceTimersByTimeAsync(3000);
    }
    expect(harnessed.callOperation).toHaveBeenCalledTimes(5);
    for (let tick = 0; tick < 2; tick += 1) {
      for (const resolve of harnessed.pending.splice(0)) resolve(answer("run"));
      await settle();
      await vi.advanceTimersByTimeAsync(3000);
    }
    expect(harnessed.callOperation).toHaveBeenCalledTimes(7);
    expect(harnessed.panelText()).toContain("run");
  });

  /** Reads F7: the poll stayed on the last session the panel drew. The tab's badge now moves it. */
  it("follows the selected session through the tab badge while the panel is closed", async () => {
    const pending: ((value: unknown) => void)[] = [];
    const callOperation = vi.fn((_operation: string, _input: unknown) => new Promise<unknown>((resolve) => { pending.push(resolve); }));
    const contribution = plugin.activate({ apiVersion: 2, pluginId: "subagents", runtimePluginId: "subagents", html: litHtml, svg: litSvg, callOperation } as unknown as PluginActivationContext).contributions.workspacePanels?.[0];
    if (contribution === undefined) throw new Error("no panel");
    const panelFor = (path: string) => ({ machine: { id: "local" }, workspace: { id: "w", projectId: "p", path: "/w" }, state: { selectedSession: { path } }, host: { requestRender: () => undefined } } as unknown as WorkspacePanelContext);
    litRender(contribution.render(panelFor(SESSION)), document.createElement("div"));
    pending[0]?.(answer("from-a"));
    await settle();

    contribution.badge?.(panelFor("/sessions/session-b.jsonl"));
    for (const resolve of pending.splice(0)) resolve(answer("from-b"));
    await settle();
    await vi.advanceTimersByTimeAsync(3000);

    const asked = callOperation.mock.calls.map((call) => (call[1] as { sessionFile: string }).sessionFile);
    expect(asked.slice(1)).toEqual(["/sessions/session-b.jsonl", "/sessions/session-b.jsonl"]);
  });

  it("reads nothing at all while no session is selected, and never starts a poller", async () => {
    const container = document.createElement("div");
    const pending: ((value: unknown) => void)[] = [];
    const callOperation = vi.fn(() => new Promise<unknown>((resolve) => { pending.push(resolve); }));
    const context = { apiVersion: 2, pluginId: "subagents", runtimePluginId: "subagents", html: litHtml, svg: litSvg, callOperation } as unknown as PluginActivationContext;
    const contribution = plugin.activate(context).contributions.workspacePanels?.[0];
    if (contribution === undefined) throw new Error("no panel");
    const panel = { machine: { id: "local" }, workspace: { id: "w", projectId: "p", path: "/w" }, state: { selectedSession: undefined }, host: { requestRender: () => undefined } } as unknown as WorkspacePanelContext;
    litRender(contribution.render(panel), container);
    expect((container.textContent ?? "")).toContain("Open a session");
    await vi.advanceTimersByTimeAsync(9000);
    expect(callOperation).not.toHaveBeenCalled();
  });
});
