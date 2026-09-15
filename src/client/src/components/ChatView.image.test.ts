import type { TemplateResult } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatLine } from "./shared";
import {
  ChatView,
  chatImagePartSource,
  chatMessageAnchorKey,
  chatToolOutputLabel,
  withRetryNonce,
} from "./ChatView";
import { templateEventHandlerAfterMarker, templateStrings, templateValuesAfterMarker } from "../templateInspection.testSupport";

describe("ChatView image content derivation", () => {
  // Content/attribute derivation (image src/alt, the tool-output header label,
  // and the scroll-anchor key) lives in pure exported seams rather than being
  // scraped from rendered `TemplateResult` markup, per the testing-guide rule
  // that TemplateResult inspection is not for general content assertions.
  it("derives the image data URL and alt text from an image part", () => {
    expect(chatImagePartSource({ type: "image", mimeType: "image/png", data: "QUJD" })).toEqual({
      src: "data:image/png;base64,QUJD",
      alt: "attached image",
      appPath: false,
    });
  });

  it("addresses a deferred tool-result image through the session's own scope", () => {
    const part = { type: "image" as const, mimeType: "image/png", ref: { toolCallId: "call 1", index: 2 } };
    const source = chatImagePartSource(part, { session: { id: "s1", cwd: "/repo" }, machineId: "remote-a" });
    expect(source).toEqual({ src: "api/machines/remote-a/sessions/s1/tool-results/call%201/images/2?cwd=%2Frepo", alt: "tool result image", appPath: true });
  });

  it("refuses to guess an address when the session scope is missing", () => {
    const part = { type: "image" as const, mimeType: "image/png", ref: { toolCallId: "call-1", index: 0 } };
    expect(chatImagePartSource(part)).toEqual({ src: "", alt: "tool result image (session scope missing)", appPath: false });
  });

  it("labels tool image output by tool name and falls back to a generic label", () => {
    expect(chatToolOutputLabel("read")).toBe("read output");
    expect(chatToolOutputLabel(undefined)).toBe("tool output");
    expect(chatToolOutputLabel("")).toBe("tool output");
  });

  it("keys a tool image message to its stable scroll anchor", () => {
    expect(chatMessageAnchorKey(7)).toBe("m:7");
  });
});

describe("ChatView image event wiring", () => {
  // Escape hatch: these two cases verify Lit event wiring (`@load` re-pin and
  // `@click` zoom) whose only observable effect is a private state/scroll side
  // effect. Vitest runs with no DOM environment here, so a shadow-DOM click
  // harness would add disproportionate setup; direct handler extraction anchored
  // to the stable `@load=`/`@click=` attribute markup is proportionate.
  it("re-pins late image loads only while already pinned to the bottom", () => {
    const view = new ChatView();
    let scrollCalls = 0;
    if (!Reflect.set(view, "scrollToBottom", () => { scrollCalls += 1; })) throw new Error("Could not observe ChatView.scrollToBottom");
    const rendered = renderPart(view, { type: "image", mimeType: "image/png", data: "QUJD" });
    const onLoad = templateEventHandlerAfterMarker(rendered, "@load=");

    if (!Reflect.set(view, "pinnedToBottom", true)) throw new Error("Could not set ChatView.pinnedToBottom");
    onLoad(new Event("load"));
    if (!Reflect.set(view, "pinnedToBottom", false)) throw new Error("Could not set ChatView.pinnedToBottom");
    onLoad(new Event("load"));

    expect(scrollCalls).toBe(1);
  });

  it("opens and closes the image zoom target on click and close", () => {
    const view = new ChatView();
    const part = { type: "image", mimeType: "image/png", data: "QUJD" } as const;
    const rendered = renderPart(view, part);
    const onClick = templateEventHandlerAfterMarker(rendered, "@click=");

    expect(zoomedImage(view)).toBeUndefined();
    onClick(new Event("click"));
    expect(zoomedImage(view)).toEqual({ src: "data:image/png;base64,QUJD", alt: "attached image" });

    const close: unknown = Reflect.get(view, "closeImageZoom");
    if (typeof close !== "function") throw new Error("ChatView.closeImageZoom is not callable");
    close.call(view);
    expect(zoomedImage(view)).toBeUndefined();
  });
});

function zoomedImage(view: ChatView): unknown {
  return Reflect.get(view, "zoomedImage");
}

type RenderPart = (this: ChatView, part: ChatLine["parts"][number], message?: ChatLine) => TemplateResult;

function renderPart(view: ChatView, part: ChatLine["parts"][number], message?: ChatLine): TemplateResult {
  const method: unknown = Reflect.get(view, "renderPart");
  if (!isRenderPart(method)) throw new Error("ChatView.renderPart is not callable");
  return method.call(view, part, message);
}

function isRenderPart(value: unknown): value is RenderPart {
  return typeof value === "function";
}

describe("deferred image failure and retry", () => {
  const ref = { type: "image" as const, mimeType: "image/png", ref: { toolCallId: "call-1", index: 1 } };
  beforeEach(() => { vi.stubGlobal("document", { baseURI: "https://pi.example.test/" }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  function scopedView(): ChatView {
    const view = new ChatView();
    view.sessionId = "s1";
    view.sessionCwd = "/repo";
    view.drawerMachineId = "local";
    return view;
  }

  it("turns a failed fetch into a tap-to-retry row instead of a broken glyph", () => {
    const view = scopedView();
    const first = renderPart(view, ref);
    expect(templateStrings(first).join("")).toContain("<img");
    const onError = templateEventHandlerAfterMarker(first, "@error=");
    onError(new Event("error"));

    const errored = renderPart(view, ref);
    expect(templateStrings(errored).join("")).toContain("chat-image-retry");
    expect(templateStrings(errored).join("")).not.toContain("<img");
  });

  it("re-addresses the same block with a nonce on retry so the cached failure is not replayed", () => {
    const view = scopedView();
    templateEventHandlerAfterMarker(renderPart(view, ref), "@error=")(new Event("error"));
    const onRetry = templateEventHandlerAfterMarker(renderPart(view, ref), "@click=");
    onRetry(new Event("click"));

    const retried = renderPart(view, ref);
    expect(templateStrings(retried).join("")).toContain("<img");
    const src = String(templateValuesAfterMarker(retried, "src=")[0]);
    expect(src).toContain("/tool-results/call-1/images/1");
    expect(src).toContain("retry=1");
  });

  it("appends the retry nonce after existing query parameters", () => {
    expect(withRetryNonce("x/images/1?cwd=%2Frepo", 0)).toBe("x/images/1?cwd=%2Frepo");
    expect(withRetryNonce("x/images/1?cwd=%2Frepo", 2)).toBe("x/images/1?cwd=%2Frepo&retry=2");
    expect(withRetryNonce("x/images/1", 1)).toBe("x/images/1?retry=1");
  });
});
