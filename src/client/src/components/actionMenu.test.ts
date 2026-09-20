import { afterEach, describe, expect, it, vi } from "vitest";
import { actionMenuPanelStyle } from "./actionMenu";

describe("actionMenuPanelStyle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("can constrain menus to the viewport for compact shadow-root controls", () => {
    vi.stubGlobal("window", { innerWidth: 400, innerHeight: 800 });
    vi.stubGlobal("HTMLElement", FakeHTMLElement);

    const target = new FakeHTMLElement({ top: 10, right: 390, bottom: 46, left: 354 });

    expect(actionMenuPanelStyle(target, { constrainTo: "viewport" })).toBe("top: 46px; max-height: 754px; right: 10px; max-width: 390px;");
  });
});

describe("actionMenuPanelStyle in a narrow column", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sits inside the bounds instead of hanging off the left of a narrow trigger", () => {
    vi.stubGlobal("window", { innerWidth: 393, innerHeight: 850 });
    vi.stubGlobal("HTMLElement", FakeHTMLElement);
    const trigger = new FakeHTMLElement({ top: 200, bottom: 244, left: 150, right: 194 });

    const style = actionMenuPanelStyle(trigger, { constrainTo: "viewport" });

    expect(style).toContain("left: 0px;");
    expect(style).toContain("right: 0px;");
  });

  it("still right-aligns to a trigger with room for a readable menu", () => {
    vi.stubGlobal("window", { innerWidth: 393, innerHeight: 850 });
    vi.stubGlobal("HTMLElement", FakeHTMLElement);
    const trigger = new FakeHTMLElement({ top: 200, bottom: 244, left: 330, right: 385 });

    const style = actionMenuPanelStyle(trigger, { constrainTo: "viewport" });

    expect(style).toContain("right: 8px;");
    expect(style).not.toContain("left: 0px;");
  });
});

class FakeHTMLElement extends EventTarget {
  constructor(private readonly rect: { top: number; right: number; bottom: number; left: number }) {
    super();
  }

  getBoundingClientRect(): { top: number; right: number; bottom: number; left: number } {
    return this.rect;
  }
}
