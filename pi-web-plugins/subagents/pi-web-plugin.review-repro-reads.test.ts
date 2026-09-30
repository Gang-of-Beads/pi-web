// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unused-vars -- review repro fixture: stubs reach into private runtime shapes; rewritten as a permanent test when its phase removes it.fails */
import { html as litHtml, render as litRender, svg as litSvg, type TemplateResult } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginActivationContext, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { ON_SCREEN_MARKER_TAG, type OnScreenMarker } from "./onScreenMarker.js";
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
    state: { selectedSession: { path: SESSION }, status: { isStreaming: true } },
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
    await vi.advanceTimersByTimeAsync(36_000);
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
    const panel = { machine: { id: "local" }, workspace: { id: "w", projectId: "p", path: "/w" }, state: { selectedSession: { path: SESSION }, status: { isStreaming: true } }, host: { requestRender: () => { litRender(contribution.render(panel), container); } } } as unknown as WorkspacePanelContext;
    litRender(contribution.render(panel), container);
    pending[0]?.(answer("kept-run"));
    await settle();
    expect((container.textContent ?? "")).toContain("kept-run");

    await vi.advanceTimersByTimeAsync(3000);
    expect(rejecting).toHaveLength(2);
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

  it("keeps polling while the session works and the panel draws each answer", async () => {
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

  /** Object model §4.3: an idle session's run list cannot change, so the panel reads it once and stays quiet. */
  it("reads an idle session's runs once and then asks nothing more", async () => {
    const callOperation = vi.fn((_operation: string, _input: unknown) => Promise.resolve(answer("done")));
    const contribution = plugin.activate({ apiVersion: 2, pluginId: "subagents", runtimePluginId: "subagents", html: litHtml, svg: litSvg, callOperation } as unknown as PluginActivationContext).contributions.workspacePanels?.[0];
    if (contribution === undefined) throw new Error("no panel");
    const idle = { machine: { id: "local" }, workspace: { id: "w", projectId: "p", path: "/w" }, state: { selectedSession: { path: SESSION }, status: { isStreaming: false } }, host: { requestRender: () => undefined } } as unknown as WorkspacePanelContext;
    litRender(contribution.render(idle), document.createElement("div"));
    await settle();

    await vi.advanceTimersByTimeAsync(60_000);
    contribution.badge?.(idle);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(callOperation).toHaveBeenCalledTimes(1);
  });

  /** Reads F7: the poll stayed on the last session the panel drew. The tab's badge now moves it. */
  it("follows the selected session through the tab badge while the panel is closed", async () => {
    const pending: ((value: unknown) => void)[] = [];
    const callOperation = vi.fn((_operation: string, _input: unknown) => new Promise<unknown>((resolve) => { pending.push(resolve); }));
    const contribution = plugin.activate({ apiVersion: 2, pluginId: "subagents", runtimePluginId: "subagents", html: litHtml, svg: litSvg, callOperation } as unknown as PluginActivationContext).contributions.workspacePanels?.[0];
    if (contribution === undefined) throw new Error("no panel");
    const panelFor = (path: string) => ({ machine: { id: "local" }, workspace: { id: "w", projectId: "p", path: "/w" }, state: { selectedSession: { path }, status: { isStreaming: true } }, host: { requestRender: () => undefined } } as unknown as WorkspacePanelContext);
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

interface Watched {
  readonly callOperation: ReturnType<typeof vi.fn>;
  readonly pending: ((value: unknown) => void)[];
  show(status: unknown): void;
  hide(): void;
  redraw(): void;
  settleActivity(): void;
  dispose(): void;
}

/**
 * A panel as the host keeps it: drawn on every request, on screen or not. Going off screen is
 * what the page's observer tells the panel's marker, as it does when the phone shows the chat.
 */
function watched(status: unknown): Watched {
  const container = document.createElement("div");
  const pending: ((value: unknown) => void)[] = [];
  const listeners: (() => void)[] = [];
  const callOperation = vi.fn((_operation: string, _input: unknown) => new Promise<unknown>((resolve) => { pending.push(resolve); }));
  const on = (kind: string, listener: () => void) => { if (kind === "session-activity-settled") listeners.push(listener); return () => undefined; };
  const activated = plugin.activate({ apiVersion: 2, pluginId: "subagents", runtimePluginId: "subagents", html: litHtml, svg: litSvg, callOperation, on } as unknown as PluginActivationContext);
  const contribution = activated.contributions.workspacePanels?.[0];
  if (contribution === undefined) throw new Error("no panel");
  let current = status;
  const panel = (): WorkspacePanelContext => ({ machine: { id: "local" }, workspace: { id: "w", projectId: "p", path: "/w" }, state: { selectedSession: { path: SESSION }, status: current }, host: { requestRender: () => { draw(); } } } as unknown as WorkspacePanelContext);
  const marker = (): OnScreenMarker => {
    const found = container.querySelector<OnScreenMarker>(ON_SCREEN_MARKER_TAG);
    if (found === null) throw new Error("the panel drew no on-screen marker");
    return found;
  };
  const draw = (): void => { litRender(contribution.render(panel()), container); };
  draw();
  return {
    callOperation,
    pending,
    show: (next) => {
      current = next;
      draw();
      marker().onChange?.(true);
    },
    hide: () => { marker().onChange?.(false); },
    redraw: () => { draw(); },
    settleActivity: () => { for (const listener of listeners) listener(); },
    dispose: () => { activated.dispose?.(); },
  };
}

const answerAll = async (panel: Watched, agent: string): Promise<void> => {
  for (const resolve of panel.pending.splice(0)) resolve(answer(agent));
  await settle();
};

describe("when the subagents panel reads while nobody watches it (review p3b)", () => {
  it("stops polling once the panel and its badge are off screen, and reads once when they are back", async () => {
    const panel = watched({ isStreaming: true });
    await answerAll(panel, "run");
    await vi.advanceTimersByTimeAsync(3000);
    await answerAll(panel, "run");
    const whileWatched = panel.callOperation.mock.calls.length;

    panel.hide();
    for (let tick = 0; tick < 20; tick += 1) {
      await vi.advanceTimersByTimeAsync(3000);
      await answerAll(panel, "run");
    }
    const whileHidden = panel.callOperation.mock.calls.length - whileWatched;

    panel.show({ isStreaming: false });
    await answerAll(panel, "done");
    await vi.advanceTimersByTimeAsync(60_000);

    expect({ whileWatched, whileHidden, onReturn: panel.callOperation.mock.calls.length - whileWatched - whileHidden }).toEqual({ whileWatched: 2, whileHidden: 2, onReturn: 1 });
  });

  it("reads at once when the reader comes back to a session still working, not on the next poll", async () => {
    const panel = watched({ isStreaming: true });
    await answerAll(panel, "run");
    panel.hide();
    for (let tick = 0; tick < 4; tick += 1) {
      await vi.advanceTimersByTimeAsync(3000);
      await answerAll(panel, "run");
    }
    const beforeReturn = panel.callOperation.mock.calls.length;

    panel.show({ isStreaming: true });

    expect(panel.callOperation.mock.calls.length - beforeReturn).toBe(1);
  });

  it("reads nothing while the host redraws the panel off screen, even after work settled, and reads once when it is back", async () => {
    const panel = watched({ isStreaming: false });
    await answerAll(panel, "before");
    panel.hide();
    panel.settleActivity();
    panel.redraw();
    panel.redraw();
    const whileHidden = panel.callOperation.mock.calls.length;

    panel.show({ isStreaming: false });

    expect({ whileHidden, afterReturn: panel.callOperation.mock.calls.length }).toEqual({ whileHidden: 1, afterReturn: 2 });
  });

  it("reads again on the next look after the session's work settled out of sight, and not without it", async () => {
    const panel = watched({ isStreaming: false });
    await answerAll(panel, "before");
    panel.hide();
    panel.show({ isStreaming: false });
    const withoutWork = panel.callOperation.mock.calls.length;

    panel.hide();
    panel.settleActivity();
    panel.show({ isStreaming: false });

    expect({ withoutWork, afterSettled: panel.callOperation.mock.calls.length }).toEqual({ withoutWork: 1, afterSettled: 2 });
  });

  it("stops polling when the host unregisters the plugin", async () => {
    const panel = watched({ isStreaming: true });
    await answerAll(panel, "run");
    panel.dispose();
    for (let tick = 0; tick < 5; tick += 1) {
      await vi.advanceTimersByTimeAsync(3000);
      await answerAll(panel, "run");
    }
    expect(panel.callOperation).toHaveBeenCalledTimes(1);
  });

  it("reads once more when work ends during a read that was asked before it ended, then goes quiet", async () => {
    const panel = watched({ isStreaming: true });
    await answerAll(panel, "run");
    await vi.advanceTimersByTimeAsync(3000);
    const pollOnItsWay = panel.callOperation.mock.calls.length;

    panel.show({ isStreaming: false });
    const beforeItLands = panel.callOperation.mock.calls.length;
    await answerAll(panel, "still-running");
    const afterItLands = panel.callOperation.mock.calls.length;
    await answerAll(panel, "done");
    await vi.advanceTimersByTimeAsync(60_000);

    expect({ pollOnItsWay, beforeItLands, afterItLands, total: panel.callOperation.mock.calls.length }).toEqual({ pollOnItsWay: 2, beforeItLands: 2, afterItLands: 3, total: 3 });
  });
});
