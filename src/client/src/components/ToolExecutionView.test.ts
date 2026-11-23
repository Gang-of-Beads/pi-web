import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import { ToolExecutionView } from "./ToolExecutionView";
import type { ToolExecutionPart } from "./shared";
import { isTemplateEventHandler, isTemplateResult, templateValueAfterMarker, templateValuesAfterMarker } from "../templateInspection.testSupport";

/**
 * The card owns no disclosure of its own: both the output and the diff read a property and report
 * the native toggle upward, so the transcript keeps the state across the rebuild reading earlier
 * rows performs (r218).
 */
function view(overrides: Partial<ToolExecutionView> = {}): ToolExecutionView {
  const card = new ToolExecutionView();
  card.execution = { type: "toolExecution", toolName: "bash", summary: "run", status: "success", resultText: "out" };
  return Object.assign(card, overrides);
}

function render(card: ToolExecutionView): TemplateResult {
  const drawn: unknown = card.render();
  if (!isTemplateResult(drawn)) throw new Error("ToolExecutionView.render did not draw a template");
  return drawn;
}

function editExecution(): ToolExecutionPart {
  return { type: "toolExecution", toolName: "edit", summary: "edit", status: "success", details: { diff: "-a\\n+b" } };
}

function toggleHandler(template: TemplateResult, index: number): (event: Event) => void {
  const handler = templateValuesAfterMarker(template, "@toggle=")[index];
  if (!isTemplateEventHandler(handler)) throw new Error("No toggle handler at that position");
  return handler;
}

function dispatchDetailsToggle(handler: (event: Event) => void, open: boolean): void {
  const hadDetailsElement = Reflect.has(globalThis, "HTMLDetailsElement");
  const previousDetailsElement = Reflect.get(globalThis, "HTMLDetailsElement");
  class StubDetailsElement extends EventTarget {
    constructor(readonly open: boolean) {
      super();
    }
  }
  Reflect.set(globalThis, "HTMLDetailsElement", StubDetailsElement);
  try {
    const details = new StubDetailsElement(open);
    details.addEventListener("toggle", (event) => { handler(event); });
    details.dispatchEvent(new Event("toggle"));
  } finally {
    if (hadDetailsElement) Reflect.set(globalThis, "HTMLDetailsElement", previousDetailsElement);
    else Reflect.deleteProperty(globalThis, "HTMLDetailsElement");
  }
}

describe("tool card disclosure", () => {
  it("opens the output by the property, not by the execution status", () => {
    expect(templateValueAfterMarker(render(view({ textOpen: true })), "?open=")).toBe(true);
    expect(templateValueAfterMarker(render(view({ textOpen: false })), "?open=")).toBe(false);
  });

  it("reports an output toggle as the output surface", () => {
    const reported: [string, boolean][] = [];
    const card = view({ onDisclosureToggle: (surface, open) => { reported.push([surface, open]); } });

    dispatchDetailsToggle(toggleHandler(render(card), 0), true);

    expect(reported).toEqual([["toolText", true]]);
  });

  it("draws a diff open by default and reports its toggle as the diff surface", () => {
    const reported: [string, boolean][] = [];
    const card = view({ onDisclosureToggle: (surface, open) => { reported.push([surface, open]); } });
    card.execution = editExecution();

    const drawn = render(card);
    expect(templateValuesAfterMarker(drawn, "?open=")).toEqual([true]);

    dispatchDetailsToggle(toggleHandler(drawn, 0), false);

    expect(reported).toEqual([["toolDiff", false]]);
  });
});
