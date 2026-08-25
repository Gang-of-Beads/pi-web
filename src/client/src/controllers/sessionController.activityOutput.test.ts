import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
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

    expect(read().error).toBe("Error: gone");
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

  it("closes back to nothing", async () => {
    const api: typeof defaultApi = { ...defaultApi, subagentRunOutput: () => Promise.resolve("# report\n") };
    const { controller, read } = controllerWith(api);

    await controller.openSubagentRunOutput(run);
    controller.closeActivityOutput();

    expect(read().activityOutput).toBeUndefined();
  });
});
