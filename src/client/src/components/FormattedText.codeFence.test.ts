// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
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
