// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "./TerminalPanel.js";

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

describe("TerminalPanel expanded geometry", () => {
  it("refits through the existing resize path after each layout transition", async () => {
    const panel = new TerminalPanel();
    const fitAndNotify = vi.fn();
    if (!Reflect.set(panel, "fitAndNotify", fitAndNotify)) throw new Error("Could not replace terminal fit method");
    document.body.append(panel);
    await panel.updateComplete;
    fitAndNotify.mockClear();

    panel.expanded = true;
    await panel.updateComplete;
    expect(fitAndNotify).toHaveBeenCalledTimes(1);

    fitAndNotify.mockClear();
    panel.expanded = false;
    await panel.updateComplete;
    expect(fitAndNotify).toHaveBeenCalledTimes(1);
  });

  it("limits the expansion control to the desktop media rule", () => {
    const sheet = terminalStyleText();
    expect(sheet).toContain(".copy-mode-toggle, .soft-keys-toggle, terminal-soft-keys { display: none; }");
    expect(sheet).toMatch(/@media \(pointer: coarse\), \(max-width: 760px\)[\s\S]*?\.terminal-tabs > button \{ height: 44px; \}/u);
  });
});

function observerStub() {
  return class ObserverStub {
    observe(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  };
}

function terminalStyleText(): string {
  return [TerminalPanel.styles].flat(3).map((sheet) => "cssText" in sheet ? sheet.cssText : "").join("\n");
}
