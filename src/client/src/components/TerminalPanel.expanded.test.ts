// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "./TerminalPanel";

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", observerStub());
  vi.stubGlobal("ResizeObserver", observerStub());
  vi.stubGlobal("MutationObserver", observerStub());
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TerminalPanel expanded view", () => {
  it("offers a truthful reversible control without changing terminal selection", async () => {
    const panel = new TerminalPanel();
    panel.selectedTerminalId = "terminal-1";
    panel.onExpandedChange = vi.fn();
    document.body.append(panel);
    await panel.updateComplete;

    const expand = terminalButton(panel, "Expand terminal");
    expect(expand.getAttribute("aria-pressed")).toBe("false");
    expand.click();
    expect(panel.onExpandedChange).toHaveBeenCalledWith(true);
    expect(panel.selectedTerminalId).toBe("terminal-1");

    panel.expanded = true;
    await panel.updateComplete;
    const exit = terminalButton(panel, "Exit expanded terminal");
    expect(exit.getAttribute("aria-pressed")).toBe("true");
    exit.click();
    expect(panel.onExpandedChange).toHaveBeenLastCalledWith(false);
  });

  it("exits the shell presentation when disconnected", async () => {
    const panel = new TerminalPanel();
    panel.expanded = true;
    panel.onExpandedChange = vi.fn();
    document.body.append(panel);
    await panel.updateComplete;

    panel.remove();

    expect(panel.onExpandedChange).toHaveBeenLastCalledWith(false);
  });

  it("limits the expansion control to the desktop media rule", () => {
    const sheet = String(TerminalPanel.styles);
    expect(sheet).toContain(".fullscreen-toggle, terminal-soft-keys { display: none; }");
    expect(sheet).toMatch(/@media \(min-width: 1181px\)\s*\{\s*\.fullscreen-toggle\s*\{\s*display: inline-flex;/u);
  });
});

function terminalButton(panel: TerminalPanel, label: string): HTMLButtonElement {
  const button = [...(panel.shadowRoot?.querySelectorAll("button") ?? [])]
    .find((candidate) => candidate.textContent.trim() === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing terminal button: ${label}`);
  return button;
}

function observerStub() {
  return class ObserverStub {
    observe(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  };
}
