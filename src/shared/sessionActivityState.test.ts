import { describe, expect, it } from "vitest";
import type { SessionStatus } from "./apiTypes";
import type { DeclaredSessionState } from "./declaredSessionStates";
import { declaredBusyWords, sessionActivityCategory } from "./sessionActivityState";

function status(over: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "s",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...over,
  };
}

describe("a session parked on an extension dialog", () => {
  it("is asking, in the rows as well as in the dock", () => {
    const dialog = { dialogId: "d1", kind: "confirm" as const, title: "Update pi?", askedAt: "", runScoped: true };
    // Session rows read this classifier; leaving dialogs out of it meant the
    // one session actually blocked on the user looked like the idle one.
    expect(sessionActivityCategory(status({ pendingDialogs: [dialog] }), undefined)).toBe("asking");
    expect(sessionActivityCategory(status({ pendingDialogs: [] }), undefined)).toBe("idle");
  });
});

describe("a session whose turn ended while its children run on", () => {
  const activity = { sessionId: "s", phase: "idle" as const, label: "idle", at: "" };

  it("is background, not idle", () => {
    // The chat says "idle · 1 background run"; the rows said nothing at all,
    // because neither status nor activity carried the count.
    expect(sessionActivityCategory(status({ backgroundRunCount: 1 }), activity)).toBe("busy");
    expect(sessionActivityCategory(status({ backgroundRunCount: 0 }), activity)).toBe("idle");
    expect(sessionActivityCategory(status(), activity)).toBe("idle");
  });

  it("lets a question waiting for the reader outrank the failure before it, as D3 orders them", () => {
    const dialog = { dialogId: "d1", kind: "confirm" as const, title: "?", askedAt: "", runScoped: true };
    const failed = { ...activity, phase: "error" as const };

    expect({
      asked: sessionActivityCategory(status({ pendingDialogs: [dialog] }), failed),
      notAsked: sessionActivityCategory(status(), failed),
      noStatus: sessionActivityCategory(undefined, failed),
    }).toEqual({ asked: "asking", notAsked: "error", noStatus: "error" });
  });

  it("still reports the work the user is actually blocked on", () => {
    // Background is the weakest signal there is: it must never hide an error,
    // a question, or a turn that is genuinely still running.
    expect(sessionActivityCategory(status({ backgroundRunCount: 2, isStreaming: true }), activity)).toBe("working");
    expect(sessionActivityCategory(status({ backgroundRunCount: 2 }), { ...activity, phase: "error" })).toBe("error");
    const dialog = { dialogId: "d1", kind: "confirm" as const, title: "?", askedAt: "", runScoped: true };
    expect(sessionActivityCategory(status({ backgroundRunCount: 2, pendingDialogs: [dialog] }), activity)).toBe("asking");
  });
});



describe("work an extension declares", () => {
  const declared = (states: DeclaredSessionState[]) => ({ declaredStates: states });

  it("makes an otherwise idle session busy, in the declarer's words, and never outranks the session's own turn", () => {
    const reviewing: DeclaredSessionState = { owner: "review", id: "reviewing", label: "Reviewing 3 files", tone: "accent", busy: true };
    const noted: DeclaredSessionState = { owner: "notes", id: "saved", label: "Notes saved", tone: "muted", busy: false };
    expect({
      busy: sessionActivityCategory(status(declared([reviewing])), undefined),
      quietStateOnly: sessionActivityCategory(status(declared([noted])), undefined),
      streamingWins: sessionActivityCategory(status({ ...declared([reviewing]), isStreaming: true }), undefined),
      words: declaredBusyWords(declared([reviewing, noted, { ...reviewing, owner: "core", id: "subsessions", label: "2 subsessions working" }])),
    }).toEqual({ busy: "busy", quietStateOnly: "idle", streamingWins: "working", words: "Reviewing 3 files · 2 subsessions working" });
  });

  it("reads an older daemon's count of background runs as the one state it was, and nothing as nothing", () => {
    expect([declaredBusyWords({ backgroundRunCount: 2 }), declaredBusyWords({ backgroundRunCount: 1 }), declaredBusyWords({}), declaredBusyWords({ declaredStates: [], backgroundRunCount: 3 })])
      .toEqual(["2 background runs", "1 background run", undefined, undefined]);
  });
});
