import { afterEach, describe, expect, it, vi } from "vitest";
import { html, type TemplateResult } from "lit";
import { PiWebApp } from "./PiWebApp";

// Node-environment template/state assertions, proportionate to a seam whose
// contract is the shell's dialog accounting: the entry list, the modal-layer
// ladder membership, and one close path firing onClose once.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the plugin dialog seam", () => {
  it("registers an opened dialog, hands back a closing handle, and fires onClose once", () => {
    const app = createApp();
    const onClose = vi.fn();
    const content = html`<p>Body</p>`;
    const open = openPluginDialogFn(app);

    const handle = open({ label: "Review", content, onClose });
    expect(pluginDialogLabels(app)).toEqual(["Review"]);

    handle.close();
    expect(pluginDialogLabels(app)).toEqual([]);
    expect(onClose).toHaveBeenCalledTimes(1);

    handle.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("counts a plugin dialog as a modal layer for the back gesture", () => {
    const app = createApp();
    const open = openPluginDialogFn(app);
    const modalLayerOpen = modalLayerOpenFn(app);

    expect(modalLayerOpen.call(app)).toBe(false);
    const handle = open({ label: "Pick", content: html`<p />` });
    expect(modalLayerOpen.call(app)).toBe(true);
    handle.close();
    expect(modalLayerOpen.call(app)).toBe(false);
  });

  it("closes the topmost plugin dialog when the modal layer unwinds", () => {
    const app = createApp();
    const open = openPluginDialogFn(app);
    const order: string[] = [];
    const first = open({ label: "First", content: html`<p />`, onClose: () => { order.push("first"); } });
    open({ label: "Second", content: html`<p />`, onClose: () => { order.push("second"); } });

    const closeModalLayer = closeModalLayerFn(app);
    closeModalLayer.call(app);
    expect(pluginDialogLabels(app)).toEqual(["First"]);
    expect(order).toEqual(["second"]);
    expect(first.close).toBeTypeOf("function");

    closeModalLayer.call(app);
    expect(pluginDialogLabels(app)).toEqual([]);
    expect(order).toEqual(["second", "first"]);
  });

  it("renders each open dialog as a modal surface carrying the plugin content", () => {
    const app = createApp();
    const open = openPluginDialogFn(app);
    open({ label: "Review", content: html`<p class="probe-body">Body</p>` });

    const text = templateToString(app.render());
    expect(text).toContain("modal-surface");
    expect(text).toContain("probe-body");
  });

  it("defaults to the overlay presentation and takes fullscreen only when asked", () => {
    const app = createApp();
    const open = openPluginDialogFn(app);
    open({ label: "Sheet", content: html`<p>Small</p>` });
    open({ label: "Console", content: html`<p>Wide</p>`, presentation: "fullscreen" });

    const text = templateToString(app.render());
    expect(text).toContain("plugin-dialog-fullscreen");
    expect(text.split("plugin-dialog-fullscreen")).toHaveLength(2);
  });
});

function createApp(): PiWebApp {
  const matchMedia = (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined });
  vi.stubGlobal("window", {
    location: { search: "" },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    matchMedia,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
    history: { pushState: () => undefined },
  });
  if (typeof document === "undefined") {
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/", visibilityState: "visible", hasFocus: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
  }
  vi.stubGlobal("requestAnimationFrame", () => 1);
  const app = new PiWebApp();
  Object.defineProperty(app, "getBoundingClientRect", { value: () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) });
  return app;
}

interface PluginDialogInput {
  label: string;
  content: TemplateResult;
  presentation?: "overlay" | "fullscreen";
  onClose?: () => void;
}

interface PluginDialogHandleLike {
  close: () => void;
}

function openPluginDialogFn(app: PiWebApp): (dialog: PluginDialogInput) => PluginDialogHandleLike {
  const method: unknown = Reflect.get(app, "openPluginDialog");
  if (!isOpenPluginDialog(method)) throw new Error("PiWebApp.openPluginDialog is not callable");
  return (dialog) => method.call(app, dialog);
}

function isOpenPluginDialog(value: unknown): value is (dialog: PluginDialogInput) => PluginDialogHandleLike {
  return typeof value === "function";
}

function modalLayerOpenFn(app: PiWebApp): () => boolean {
  const method: unknown = Reflect.get(app, "modalLayerOpen");
  if (!isBooleanMethod(method)) throw new Error("PiWebApp.modalLayerOpen is not callable");
  return () => method.call(app);
}

function isBooleanMethod(value: unknown): value is { call(self: PiWebApp): boolean } {
  return typeof value === "function";
}

function closeModalLayerFn(app: PiWebApp): () => void {
  const method: unknown = Reflect.get(app, "closeModalLayer");
  if (typeof method !== "function") throw new Error("PiWebApp.closeModalLayer is not callable");
  return () => { method.call(app); };
}

interface PluginDialogEntryLike {
  dialog: { label?: unknown };
}

function isPluginDialogEntry(value: unknown): value is PluginDialogEntryLike {
  return typeof value === "object" && value !== null && "dialog" in value;
}

function pluginDialogLabels(app: PiWebApp): string[] {
  const entries: unknown = Reflect.get(app, "pluginDialogs");
  if (!Array.isArray(entries)) throw new Error("PiWebApp pluginDialogs was unavailable");
  return entries.map((entry) => {
    if (!isPluginDialogEntry(entry)) throw new Error("Plugin dialog entry was malformed");
    const label = entry.dialog.label;
    if (typeof label !== "string") throw new Error("Plugin dialog label was not a string");
    return label;
  });
}

function templateToString(template: TemplateResult): string {
  const parts: string[] = [];
  for (const value of template.values) {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) parts.push(value.map((item) => (isTemplateResult(item) ? templateToString(item) : "")).join("|"));
    else if (isTemplateResult(value)) parts.push(templateToString(value));
    else parts.push(String(value));
  }
  return template.strings.join("|") + "|" + parts.join("|");
}

function isTemplateResult(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && "strings" in value && "values" in value;
}
