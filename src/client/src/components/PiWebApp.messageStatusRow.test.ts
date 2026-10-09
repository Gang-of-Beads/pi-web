import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import { initialAppState, type AppState } from "../appState";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * The status of a sent message speaks through the app's one row (state-diagram D5, P1 slice 6):
 * a ledger that went unanswered for the session on screen is reported like any unanswered read,
 * after the grace, and never for a session or machine that is not the one on screen.
 */
describe("PiWebApp message status row", () => {
  it("reports the unanswered message status of the session on screen, after the grace", () => {
    const app = stubbedApp();
    const since = Date.now() - 60_000;
    setAppState(app, { ...initialAppState(), selectedSession: session("on-screen"), messageStatusUnanswered: { machineId: "local", sessionId: "on-screen", since, miss: { kind: "link-down" } } });

    renderRow(app);

    expect(shownMiss(app)).toEqual({ kind: "link-down" });
  });

  it("says nothing for another session's or another machine's message status", () => {
    const app = stubbedApp();
    const since = Date.now() - 60_000;
    setAppState(app, { ...initialAppState(), selectedSession: session("on-screen"), messageStatusUnanswered: { machineId: "local", sessionId: "elsewhere", since, miss: { kind: "link-down" } } });
    renderRow(app);
    const otherSession = shownMiss(app);
    setAppState(app, { ...initialAppState(), selectedSession: session("on-screen"), messageStatusUnanswered: { machineId: "remote-1", sessionId: "on-screen", since, miss: { kind: "link-down" } } });
    renderRow(app);

    expect({ otherSession, otherMachine: shownMiss(app) }).toEqual({ otherSession: undefined, otherMachine: undefined });
  });
});

describe("a message status claim when the reader leaves its session", () => {
  it("ends with the episode, so coming back shows nothing counted from before", () => {
    const app = stubbedApp();
    const since = Date.now() - 60_000;
    setAppState(app, { ...initialAppState(), selectedSession: session("on-screen"), messageStatusUnanswered: { machineId: "local", sessionId: "on-screen", since, miss: { kind: "link-down" } } });
    const stays = callSetState(app, { selectedSession: session("on-screen"), sessions: [] });
    const leaves = callSetState(app, { selectedSession: session("elsewhere") });
    callSetState(app, { selectedSession: session("on-screen") });
    renderRow(app);

    expect({ stays: stays?.miss.kind, leaves, back: shownMiss(app) }).toEqual({ stays: "link-down", leaves: undefined, back: undefined });
  });
});

function callSetState(app: PiWebApp, patch: Partial<AppState>): AppState["messageStatusUnanswered"] {
  const method: unknown = Reflect.get(app, "setState");
  if (typeof method !== "function") throw new Error("PiWebApp.setState is not callable");
  method.call(app, patch);
  const state: unknown = Reflect.get(app, "state");
  if (typeof state !== "object" || state === null) throw new Error("PiWebApp has no state");
  const claim: unknown = Reflect.get(state, "messageStatusUnanswered");
  return isClaim(claim) ? claim : undefined;
}

function isClaim(value: unknown): value is NonNullable<AppState["messageStatusUnanswered"]> {
  return typeof value === "object" && value !== null && "sessionId" in value && "miss" in value;
}

function session(id: string): SessionInfo {
  return { id, cwd: "/repo", path: `/repo/${id}.jsonl`, created: "2026-10-01", modified: "2026-10-01", messageCount: 1, firstMessage: "hello" };
}

function stubbedApp(): PiWebApp {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { search: "", href: "https://pi.example.test/" },
    history: { state: null, replaceState: () => undefined, pushState: () => undefined },
    localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } },
    matchMedia: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  });
  if (typeof document === "undefined") {
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/", visibilityState: "visible", hasFocus: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
  }
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
  return new PiWebApp();
}

function setAppState(app: PiWebApp, state: AppState): void {
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp state");
  Reflect.set(app, "unansweredShown", undefined);
}

function renderRow(app: PiWebApp): void {
  const method: unknown = Reflect.get(app, "renderUnansweredRow");
  if (typeof method !== "function") throw new Error("PiWebApp.renderUnansweredRow is not callable");
  method.call(app, false);
}

function shownMiss(app: PiWebApp): unknown {
  const shown: unknown = Reflect.get(app, "unansweredShown");
  return typeof shown === "object" && shown !== null ? Reflect.get(shown, "miss") : undefined;
}
