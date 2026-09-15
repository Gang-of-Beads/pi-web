// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { FormattedText } from "./FormattedText";

const MERMAID = "```mermaid\ngraph TD; A-->B\n```";

async function renderText(text: string, findCodeFenceRenderer?: FormattedText["findCodeFenceRenderer"]): Promise<FormattedText> {
  const el = new FormattedText();
  el.text = text;
  if (findCodeFenceRenderer !== undefined) el.findCodeFenceRenderer = findCodeFenceRenderer;
  document.body.append(el);
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("FormattedText code fence claims", () => {
  it("draws the claimant's node above the source block and keeps the source for copy", async () => {
    const el = await renderText(MERMAID, (language) => language === "mermaid" ? { render: (source) => { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.dataset["source"] = source.trim(); return svg; } } : undefined);
    const wrapper = el.shadowRoot?.querySelector(".code-block-wrapper");
    expect(wrapper?.classList.contains("code-fence-claimed")).toBe(true);
    const drawing = wrapper?.querySelector(".code-fence-render");
    expect(drawing?.getAttribute("data-language")).toBe("mermaid");
    expect(drawing?.querySelector("svg")?.dataset["source"]).toBe("graph TD; A-->B");
    expect(wrapper?.querySelector("pre code")?.textContent.trim()).toBe("graph TD; A-->B");
  });

  it("leaves an unclaimed language, a fence without a language, and a transcript without a lookup as plain code", async () => {
    const unclaimed = await renderText(MERMAID, () => undefined);
    expect(unclaimed.shadowRoot?.querySelector(".code-fence-render")).toBeNull();
    const noLanguage = await renderText("```\nplain\n```", () => ({ render: () => document.createElement("div") }));
    expect(noLanguage.shadowRoot?.querySelector(".code-fence-render")).toBeNull();
    const noLookup = await renderText(MERMAID);
    expect(noLookup.shadowRoot?.querySelector(".code-fence-render")).toBeNull();
    expect(noLookup.shadowRoot?.querySelector("pre code")?.textContent.trim()).toBe("graph TD; A-->B");
  });

  it("keeps the plain code block when the claimant throws or rejects", async () => {
    const thrown = await renderText(MERMAID, () => ({ render: () => { throw new Error("no parser"); } }));
    expect(thrown.shadowRoot?.querySelector(".code-fence-render")).toBeNull();
    expect(thrown.shadowRoot?.querySelector(".code-block-wrapper")?.classList.contains("code-fence-claimed")).toBe(false);
    const rejected = await renderText(MERMAID, () => ({ render: () => Promise.reject(new Error("later")) }));
    expect(rejected.shadowRoot?.querySelector(".code-fence-render")).toBeNull();
    expect(rejected.shadowRoot?.querySelector("pre code")?.textContent.trim()).toBe("graph TD; A-->B");
  });

  it("drops a drawing that resolves after the text was re-parsed", async () => {
    let release: (node: Node) => void = () => undefined;
    const el = await renderText(MERMAID, () => ({ render: () => new Promise<Node>((resolve) => { release = resolve; }) }));
    el.text = "replaced entirely";
    await el.updateComplete;
    release(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(el.shadowRoot?.querySelector(".code-fence-render")).toBeNull();
  });

  it("does not touch the sanitizer: a fence body is still escaped text, never markup", async () => {
    const el = await renderText("```mermaid\n<img src=x onerror=alert(1)>\n```", () => ({ render: () => document.createElement("div") }));
    expect(el.shadowRoot?.querySelector("pre code img")).toBeNull();
    expect(el.shadowRoot?.querySelector("pre code")?.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("FormattedText code fence claims follow the registry and the stream", () => {
  const svgRenderer = { render: () => document.createElementNS("http://www.w3.org/2000/svg", "svg") };

  it("takes no claim while the message is still streaming, then claims on the settled parse", async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const el = new FormattedText();
      el.streaming = true;
      el.text = "```mermaid\ngraph TD; A";
      el.findCodeFenceRenderer = () => ({ render: (source) => { calls.push(source); return document.createElement("div"); } });
      document.body.append(el);
      await el.updateComplete;
      el.text = "```mermaid\ngraph TD; A-->B";
      await el.updateComplete;
      el.text = MERMAID;
      await el.updateComplete;
      await vi.advanceTimersByTimeAsync(400);
      await el.updateComplete;
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual([]);
      el.streaming = false;
      await el.updateComplete;
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual(["graph TD; A-->B\n"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("claims a settled fence when its plugin registers after the message drew", async () => {
    const el = await renderText(MERMAID, () => undefined);
    expect(el.shadowRoot?.querySelector(".code-fence-render")).toBeNull();
    el.findCodeFenceRenderer = () => svgRenderer;
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(el.shadowRoot?.querySelector(".code-fence-render svg")).not.toBeNull();
  });

  it("takes a drawing down when its plugin is disposed, leaving the plain block", async () => {
    const el = await renderText(MERMAID, () => svgRenderer);
    expect(el.shadowRoot?.querySelector(".code-fence-render")).not.toBeNull();
    el.findCodeFenceRenderer = () => undefined;
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".code-fence-render")).toBeNull();
    expect(el.shadowRoot?.querySelector(".code-block-wrapper")?.classList.contains("code-fence-claimed")).toBe(false);
    expect(el.shadowRoot?.querySelector("pre code")?.textContent.trim()).toBe("graph TD; A-->B");
  });

  it("does not mount a drawing that resolves after its plugin was replaced", async () => {
    let release: (node: Node) => void = () => undefined;
    const slow = { render: () => new Promise<Node>((resolve) => { release = resolve; }) };
    const el = await renderText(MERMAID, () => slow);
    el.findCodeFenceRenderer = () => undefined;
    await el.updateComplete;
    release(document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(el.shadowRoot?.querySelector(".code-fence-render")).toBeNull();
  });

  it("treats a renderer answering with a non-Node as a failure, never as content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const renderer: { render: (source: string) => Node | Promise<Node> } = { render: () => document.createElement("div") };
      Reflect.set(renderer, "render", async () => { await Promise.resolve(); });
      const el = await renderText(MERMAID, () => renderer);
      expect(el.shadowRoot?.querySelector(".code-fence-render")).toBeNull();
      expect(el.shadowRoot?.textContent).not.toContain("undefined");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("copies the fence source, not code the drawing happens to contain", async () => {
    const el = await renderText(MERMAID, () => ({ render: () => { const pre = document.createElement("pre"); const code = document.createElement("code"); code.textContent = "NOT THE SOURCE"; pre.append(code); return pre; } }));
    const wrapper = el.shadowRoot?.querySelector(".code-block-wrapper");
    expect(wrapper?.querySelector(":scope > pre > code")?.textContent.trim()).toBe("graph TD; A-->B");
    expect(wrapper?.querySelector(".code-fence-render code")?.textContent).toBe("NOT THE SOURCE");
  });
});
