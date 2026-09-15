// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createMermaidFenceRenderer, pageIsDark, type MermaidLike } from "./mermaidRenderer.js";

/**
 * The renderer must load the engine once and lazily, parse before it
 * draws, refuse (throw) on anything that is not a diagram so the host keeps
 * the plain code block, and re-theme when the page changes.
 */

interface FakeMermaid extends MermaidLike {
  calls: { initialize: { theme: string }[]; render: string[] };
}

function fakeMermaid(overrides: Partial<MermaidLike> = {}): FakeMermaid {
  const calls: FakeMermaid["calls"] = { initialize: [], render: [] };
  return {
    calls,
    initialize: (config) => { calls.initialize.push(config); },
    parse: () => Promise.resolve(true),
    render: (id) => { calls.render.push(id); return Promise.resolve({ svg: `<svg data-id="${id}"><g></g></svg>` }); },
    ...overrides,
  };
}

function harness(mermaid: MermaidLike, dark = { value: true }) {
  const loadMermaid = vi.fn(() => Promise.resolve(mermaid));
  const render = createMermaidFenceRenderer({ loadMermaid, darkTheme: () => dark.value, createElement: (tag) => document.createElement(tag) });
  return { render, loadMermaid };
}

describe("mermaid fence renderer", () => {
  it("loads the engine once, parses first, and returns a figure holding the svg", async () => {
    const mermaid = fakeMermaid();
    const { render, loadMermaid } = harness(mermaid);

    const first = await render("graph TD; A-->B");
    const second = await render("graph TD; B-->C");

    expect(loadMermaid).toHaveBeenCalledTimes(1);
    expect(mermaid.calls.initialize).toEqual([{ startOnLoad: false, securityLevel: "strict", theme: "dark" }]);
    expect(mermaid.calls.render).toEqual(["pi-web-mermaid-1", "pi-web-mermaid-2"]);
    if (!(first instanceof HTMLElement)) throw new Error("expected an element");
    expect(first.querySelector("svg")).not.toBeNull();
    expect(first).not.toBe(second);
  });

  it("throws on a parse error so the host keeps the code block", async () => {
    const mermaid = fakeMermaid({ parse: () => Promise.reject(new Error("Parse error on line 1")) });
    const { render } = harness(mermaid);

    await expect(render("not a diagram")).rejects.toThrow("Parse error on line 1");
    expect(mermaid.calls.render).toEqual([]);
  });

  it("throws on an empty fence and on an engine that produced no svg", async () => {
    const { render } = harness(fakeMermaid({ render: () => Promise.resolve({ svg: "<p>nope</p>" }) }));

    await expect(render("   ")).rejects.toThrow("Empty mermaid fence");
    await expect(render("graph TD; A")).rejects.toThrow("Mermaid produced no SVG");
  });

  it("re-initializes when the page theme flips, and retries a failed load", async () => {
    const mermaid = fakeMermaid();
    const dark = { value: false };
    let attempts = 0;
    const loadMermaid = vi.fn(() => { attempts += 1; return attempts === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(mermaid); });
    const render = createMermaidFenceRenderer({ loadMermaid, darkTheme: () => dark.value, createElement: (tag) => document.createElement(tag) });

    await expect(render("graph TD; A-->B")).rejects.toThrow("offline");
    await render("graph TD; A-->B");
    dark.value = true;
    await render("graph TD; A-->B");

    expect(loadMermaid).toHaveBeenCalledTimes(2);
    expect(mermaid.calls.initialize.map((config) => config.theme)).toEqual(["default", "dark"]);
  });
});

describe("pageIsDark", () => {
  it("judges by the page background and falls back when it is not a hex colour", () => {
    expect(pageIsDark({ getPropertyValue: () => "#0b0d10" }, false)).toBe(true);
    expect(pageIsDark({ getPropertyValue: () => "#fff9ee" }, true)).toBe(false);
    expect(pageIsDark({ getPropertyValue: () => "" }, true)).toBe(true);
    expect(pageIsDark(undefined, false)).toBe(false);
  });
});
