import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import { initialAppState } from "../appState";
import { PiWebApp } from "./PiWebApp";

/**
 * A node-environment template assertion: the branch it proves is which element stands in the
 * composer slot. The strip's own rendering and its Restore click are tested under happy-dom in
 * archivedStrip.test.ts.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const session: SessionInfo = { id: "s1", cwd: "/repo", path: "/repo/s1.jsonl", created: "2026-10-01T00:00:00.000Z", modified: "2026-10-01T00:00:00.000Z", messageCount: 1, firstMessage: "hi" };

describe("the composer slot (P2 slice b part 2, G4)", () => {
  it("holds the archived strip instead of the composer for an archived session, and the composer otherwise", () => {
    const composerOf = (selected: SessionInfo): { strip: boolean; composer: boolean } => {
      const app = createApp();
      if (!Reflect.set(app, "state", { ...initialAppState(), selectedSession: selected, mainView: "chat" })) throw new Error("could not set state");
      const text = templateToString(app.render());
      return { strip: text.includes("archived-strip"), composer: text.includes("<prompt-editor") };
    };

    expect({ archived: composerOf({ ...session, archived: true, archivedAt: "2026-10-01T00:00:00.000Z" }), live: composerOf(session) }).toEqual({
      archived: { strip: true, composer: false },
      live: { strip: false, composer: true },
    });
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
