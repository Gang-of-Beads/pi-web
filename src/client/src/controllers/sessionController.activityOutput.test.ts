import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { HttpError } from "../api";
import { defaultApi, FakeSocket, oldSession, workspace, type AppState } from "./sessionController.testSupport";

const task = { id: "b84060a70", name: "sleep timer B", command: "sleep 120", status: "running" as const, startedAt: "2026-08-25T19:00:00.000Z", bytesWritten: 0, hasOutput: true };
const run = { runId: "7c81b29c-b130-441c-be23-377217cd0a60", agent: "worker", status: "done" as const, elapsedMs: 1000, startedAt: "2026-08-25T19:00:00.000Z", hasOutput: true };

function controllerWith(api: typeof defaultApi, seed?: Partial<AppState>) {
  let state: AppState = {
    ...initialAppState(),
    selectedWorkspace: workspace,
    selectedSession: oldSession,
    sessions: [oldSession],
    ...seed,
  };
  const controller = new SessionController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    () => undefined,
    undefined,
    { api, socket: new FakeSocket() },
  );
  return { controller, read: () => state };
}

describe("reading a background task's output", () => {
  // The transcript is the record of the conversation. Writing the log into it
  // put words in the agent's mouth that it never said, vanished on reload, and
  // stacked up another copy on every click.
  it("shows the log without writing it into the conversation", async () => {
    const api: typeof defaultApi = { ...defaultApi, backgroundTaskOutput: () => Promise.resolve("line one\nline two\n") };
    const { controller, read } = controllerWith(api);

    await controller.openBackgroundTaskOutput(task);

    expect(read().messages).toEqual([]);
    expect(read().activityOutput?.text).toBe("line one\nline two\n");
    expect(read().activityOutput?.title).toContain("sleep timer B");
  });

  it("replaces the last one instead of stacking copies", async () => {
    const api: typeof defaultApi = { ...defaultApi, backgroundTaskOutput: () => Promise.resolve("tail") };
    const { controller, read } = controllerWith(api);

    await controller.openBackgroundTaskOutput(task);
    await controller.openBackgroundTaskOutput(task);

    expect(read().messages).toEqual([]);
    expect(read().activityOutput?.text).toBe("tail");
  });

  // A task whose log file exists but is still empty used to look readable and
  // then appear to do nothing at all when opened.
  it("says so when the log is empty rather than opening a blank view", async () => {
    const api: typeof defaultApi = { ...defaultApi, backgroundTaskOutput: () => Promise.resolve("") };
    const { controller, read } = controllerWith(api);

    await controller.openBackgroundTaskOutput(task);

    expect(read().messages).toEqual([]);
    expect(read().activityOutput?.empty).toBe(true);
  });

  it("reports a failed read through the error state and opens nothing", async () => {
    const api: typeof defaultApi = { ...defaultApi, backgroundTaskOutput: () => Promise.reject(new Error("gone")) };
    const { controller, read } = controllerWith(api);

    await controller.openBackgroundTaskOutput(task);

    expect(read().error).toBe("gone");
    expect(read().activityOutput).toBeUndefined();
    expect(read().messages).toEqual([]);
  });
});

describe("reading a subagent run's output", () => {
  it("shows the artifact without writing it into the conversation", async () => {
    const api: typeof defaultApi = { ...defaultApi, subagentRunOutput: () => Promise.resolve("# report\n") };
    const { controller, read } = controllerWith(api);

    await controller.openSubagentRunOutput(run);

    expect(read().messages).toEqual([]);
    expect(read().activityOutput?.text).toBe("# report\n");
    expect(read().activityOutput?.title).toContain("worker");
  });

  // A run that has written neither a result nor a step has nothing to show.
  // That is an answer, not a fault: it used to put "No output for this
  // subagent run" in a red banner across the conversation.
  it("opens empty when the run has written nothing, instead of raising an error", async () => {
    const api: typeof defaultApi = { ...defaultApi, subagentRunOutput: () => Promise.reject(new HttpError("No output for this subagent run", 404)) };
    const { controller, read } = controllerWith(api);

    await controller.openSubagentRunOutput(run);

    expect(read().error).toBe("");
    expect(read().activityOutput?.empty).toBe(true);
    expect(read().activityOutput?.title).toContain("worker");
  });

  it("still reports a run it could not reach", async () => {
    const api: typeof defaultApi = { ...defaultApi, subagentRunOutput: () => Promise.reject(new HttpError("machine unreachable", 503)) };
    const { controller, read } = controllerWith(api);

    await controller.openSubagentRunOutput(run);

    expect(read().error).toContain("machine unreachable");
    expect(read().activityOutput).toBeUndefined();
  });

  it("closes back to nothing", async () => {
    const api: typeof defaultApi = { ...defaultApi, subagentRunOutput: () => Promise.resolve("# report\n") };
    const { controller, read } = controllerWith(api);

    await controller.openSubagentRunOutput(run);
    controller.closeActivityOutput();

    expect(read().activityOutput).toBeUndefined();
  });
});

/**
 * The inconsistency this closes: a subsession row opened the session it named,
 * while an agent-run row opened a block of text - the same work told two
 * different ways. A run does have a conversation; the server projects its
 * transcript into the messages the chat view already renders.
 */
describe("opening a subagent run's conversation", () => {
  const page = { messages: [{ role: "user", content: "go" }, { role: "assistant", content: "done" }], start: 0, total: 2 };

  it("opens the conversation rather than a block of text", async () => {
    const api: typeof defaultApi = { ...defaultApi, subagentRunMessages: () => Promise.resolve(page) };
    const { controller, read } = controllerWith(api);

    await controller.openSubagentRunConversation(run);

    expect(read().activityConversation?.messages).toHaveLength(2);
    expect(read().activityConversation?.total).toBe(2);
    expect(read().activityOutput).toBeUndefined();
  });

  /** The row has to say whose run it is, or it is a conversation from nowhere. */
  it("names the run and says it belongs to this session", async () => {
    const api: typeof defaultApi = { ...defaultApi, subagentRunMessages: () => Promise.resolve(page) };
    const { controller, read } = controllerWith(api);

    await controller.openSubagentRunConversation(run);

    expect(read().activityConversation?.title).toContain("worker");
    expect(read().activityConversation?.subtitle).toContain("Child run");
  });

  /**
   * A reader who can watch a child working will reach for a way to steer it.
   * Steering rides the subagent extension's RPC on the in-process Pi event bus,
   * which this server does not hold, so the view states the boundary instead of
   * leaving an unexplained absence that reads as a missing feature.
   */
  it("says why the run cannot be steered from here", async () => {
    const api: typeof defaultApi = { ...defaultApi, subagentRunMessages: () => Promise.resolve(page) };
    const { controller, read } = controllerWith(api);

    await controller.openSubagentRunConversation(run);

    expect(read().activityConversation?.interventionUnavailable).toMatch(/not available/i);
  });

  /**
   * A child that died before opening a transcript has no conversation, but it
   * may still have written a result. Falling back keeps that reachable rather
   * than replacing one empty view with another.
   */
  it("falls back to the result when the run wrote no transcript", async () => {
    const api: typeof defaultApi = {
      ...defaultApi,
      subagentRunMessages: () => Promise.reject(new HttpError("No transcript for this subagent run", 404)),
      subagentRunOutput: () => Promise.resolve("# report\n"),
    };
    const { controller, read } = controllerWith(api);

    await controller.openSubagentRunConversation(run);

    expect(read().activityConversation).toBeUndefined();
    expect(read().activityOutput?.text).toBe("# report\n");
  });

  it("still reports a run it could not reach", async () => {
    const api: typeof defaultApi = { ...defaultApi, subagentRunMessages: () => Promise.reject(new HttpError("machine unreachable", 503)) };
    const { controller, read } = controllerWith(api);

    await controller.openSubagentRunConversation(run);

    expect(read().error).toContain("machine unreachable");
    expect(read().activityConversation).toBeUndefined();
  });

  /**
   * A husk - an empty run directory left by a child that died before writing
   * anything - has neither a transcript nor a result, so both reads answer 404.
   * Opening it must still say something: the click that led here was inert
   * once, and "nothing happens" is the failure this whole path exists to fix.
   */
  it("says a run left nothing behind rather than doing nothing at all", async () => {
    const api: typeof defaultApi = {
      ...defaultApi,
      subagentRunMessages: () => Promise.reject(new HttpError("No transcript for this subagent run", 404)),
      subagentRunOutput: () => Promise.reject(new HttpError("No output for this subagent run", 404)),
    };
    const { controller, read } = controllerWith(api);

    await controller.openSubagentRunConversation(run);

    expect(read().activityConversation).toBeUndefined();
    expect(read().activityOutput).toBeDefined();
    expect(read().activityOutput?.empty).toBe(true);
    expect(read().activityOutput?.title).toContain(run.runId.slice(0, 8));
    expect(read().error).toBe("");
  });
});
