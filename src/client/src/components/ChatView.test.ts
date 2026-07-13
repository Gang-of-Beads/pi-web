import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import type { ChatLine } from "./shared";
import { ChatView, chatMessageMetadataLabel, chatQueuedMessageSections } from "./ChatView";

describe("chatQueuedMessageSections", () => {
  it("labels client-side pending-start sends separately from server queued messages", () => {
    const sections = chatQueuedMessageSections(
      [{ kind: "followUp", text: "queued before start" }],
      [{ kind: "steer", text: "server queued" }],
    );

    expect(sections).toEqual([
      {
        heading: "Queued until session starts",
        detail: "Will send once the backend session is ready",
        messages: [{ kind: "followUp", text: "queued before start" }],
      },
      {
        heading: "Queued messages",
        detail: "1 pending · Stop clears the queue",
        messages: [{ kind: "steer", text: "server queued" }],
      },
    ]);
  });
});

describe("chatMessageMetadataLabel", () => {
  it("uses one full date and model label without a model prefix", () => {
    const timestamp = "2026-07-10T19:15:30.000Z";
    const formattedTimestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(timestamp));

    expect(chatMessageMetadataLabel({
      role: "assistant",
      parts: [],
      meta: { timestamp, model: { provider: "provider", id: "model" } },
    })).toBe(`${formattedTimestamp} · provider/model`);
  });
});

describe("ChatView technical-event groups", () => {
  const messages: ChatLine[] = [
    { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "inspect a file" }] },
    { role: "tool", parts: [{ type: "toolExecution", toolName: "read", summary: "inspect a file", status: "success", resultText: "large result" }] },
  ];

  it("defers a closed body while retaining native disclosure and group scroll anchors", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    const bodyCalls = observeGroupBodyRenders(view);

    const closed = renderMessageGroup(view, messages, 40, 41, false);

    expect(bodyCalls).toEqual([]);
    expect(templateStaticMarkup(closed)).toContain("<details");
    expect(templateStaticMarkup(closed)).toContain("<summary>");
    expect(templateStaticMarkup(closed)).toContain('aria-hidden="true"');
    expect(templateValuesAfterMarker(closed, "?open=")).toEqual([false]);
    expect(templateValuesAfterMarker(closed, "data-scroll-anchor-id=")).toEqual(["g:40"]);
    expect(templateValuesAfterMarker(closed, "data-marker-id=")).toEqual(["g:41"]);
  });

  // Direct handler extraction keeps this node-environment test focused on the
  // native details toggle wiring without introducing a component-wide DOM shim.
  it("renders an opened body with event anchors and removes it when closed again", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    const bodyCalls = observeGroupBodyRenders(view);
    const initiallyClosed = renderMessageGroup(view, messages, 40, 41, false);

    dispatchDetailsToggle(templateEventHandler(initiallyClosed, "@toggle="), true);
    const opened = renderMessageGroup(view, messages, 40, 41, false);

    expect(bodyCalls).toEqual([{ messages, startIndex: 40 }]);
    expect(templateValuesAfterMarker(opened, "?open=")).toEqual([true]);
    expect(templateValuesAfterMarker(opened, "data-scroll-anchor-id=")).toEqual(["g:40", "e:40", "e:41"]);

    bodyCalls.length = 0;
    dispatchDetailsToggle(templateEventHandler(opened, "@toggle="), false);
    const closedAgain = renderMessageGroup(view, messages, 40, 41, false);

    expect(bodyCalls).toEqual([]);
    expect(templateValuesAfterMarker(closedAgain, "?open=")).toEqual([false]);
    expect(templateValuesAfterMarker(closedAgain, "data-scroll-anchor-id=")).toEqual(["g:40"]);
  });

  it("renders a live tail body by default", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    const bodyCalls = observeGroupBodyRenders(view);

    const live = renderMessageGroup(view, messages, 40, 41, true);

    expect(bodyCalls).toEqual([{ messages, startIndex: 40 }]);
    expect(templateValuesAfterMarker(live, "?open=")).toEqual([true]);
    expect(templateValues(live)).toContain("msg event-group live");
    expect(templateValues(live)).toContain("live events");
  });
});

interface GroupBodyRenderCall {
  messages: ChatLine[];
  startIndex: number;
}

type RenderMessageGroup = (this: ChatView, messages: ChatLine[], startIndex: number, endIndex: number, defaultOpen: boolean) => TemplateResult;
type RenderMessageGroupBody = (this: ChatView, messages: ChatLine[], startIndex: number) => TemplateResult;
type TemplateEventHandler = (event: Event) => void;

function renderMessageGroup(view: ChatView, messages: ChatLine[], startIndex: number, endIndex: number, defaultOpen: boolean): TemplateResult {
  const method: unknown = Reflect.get(view, "renderMessageGroup");
  if (!isRenderMessageGroup(method)) throw new Error("ChatView.renderMessageGroup is not callable");
  return method.call(view, messages, startIndex, endIndex, defaultOpen);
}

function observeGroupBodyRenders(view: ChatView): GroupBodyRenderCall[] {
  const method: unknown = Reflect.get(view, "renderMessageGroupBody");
  if (!isRenderMessageGroupBody(method)) throw new Error("ChatView.renderMessageGroupBody is not callable");
  const calls: GroupBodyRenderCall[] = [];
  const observed: RenderMessageGroupBody = function (messages, startIndex) {
    calls.push({ messages, startIndex });
    return method.call(this, messages, startIndex);
  };
  if (!Reflect.set(view, "renderMessageGroupBody", observed)) throw new Error("Could not observe ChatView.renderMessageGroupBody");
  return calls;
}

function isRenderMessageGroup(value: unknown): value is RenderMessageGroup {
  return typeof value === "function";
}

function isRenderMessageGroupBody(value: unknown): value is RenderMessageGroupBody {
  return typeof value === "function";
}

function templateEventHandler(template: TemplateResult, marker: string): TemplateEventHandler {
  const strings = templateStrings(template);
  const values = templateValues(template);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (strings[index]?.includes(marker) === true && isTemplateEventHandler(value)) return value;
  }
  throw new Error(`Expected template event handler after ${marker}`);
}

function isTemplateEventHandler(value: unknown): value is TemplateEventHandler {
  return typeof value === "function";
}

function dispatchDetailsToggle(handler: TemplateEventHandler, open: boolean): void {
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

function templateStaticMarkup(template: TemplateResult): string {
  const chunks: string[] = [];
  visit(template);
  return chunks.join("");

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isTemplateResult(value)) return;
    chunks.push(...templateStrings(value));
    for (const child of templateValues(value)) visit(child);
  }
}

function templateValuesAfterMarker(template: TemplateResult, marker: string): unknown[] {
  const matches: unknown[] = [];
  visit(template);
  return matches;

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isTemplateResult(value)) return;
    const strings = templateStrings(value);
    const values = templateValues(value);
    for (let index = 0; index < values.length; index += 1) {
      if (strings[index]?.includes(marker) === true) matches.push(values[index]);
      visit(values[index]);
    }
  }
}

function templateStrings(template: TemplateResult): readonly string[] {
  const strings = Reflect.get(template, "strings");
  if (!isStringArray(strings)) throw new Error("TemplateResult strings were unavailable");
  return strings;
}

function templateValues(template: TemplateResult): readonly unknown[] {
  const values = Reflect.get(template, "values");
  if (!Array.isArray(values)) throw new Error("TemplateResult values were unavailable");
  return values.map((value: unknown) => value);
}

function isTemplateResult(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && isStringArray(Reflect.get(value, "strings")) && Array.isArray(Reflect.get(value, "values"));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}
