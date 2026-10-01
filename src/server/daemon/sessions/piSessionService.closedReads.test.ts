import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, testModelRuntime } from "./piSessionService.testSupport.js";
import type { ArchivedSessionRecord } from "./sessionArchiveStore.js";
import { SessionNotFoundError } from "./sessionErrors.js";

/**
 * Reading a closed session never opens it (state-diagram D5, P3 slice d). The background tasks
 * read and the transcript page read opened the runtime only to learn the file path or the
 * entries, which loaded every extension and, on an archived session, showed a startup notice
 * for a session that can take no message.
 */

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const header = (id: string) => ({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" });
const userEntry = (id: string, text: string) => ({ type: "message", id, parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: text, timestamp: 1 } });

async function file(name: string, lines: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-closed-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, name);
  await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return path;
}

function serviceFor(records: ReturnType<typeof sessionRecord>[], archived: ArchivedSessionRecord[] = []) {
  const createAgentRuntime = vi.fn(() => Promise.reject(new Error("a read of a closed session must not open a runtime")));
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    createAgentRuntime,
    archiveStore: {
      list: () => Promise.resolve(archived),
      get: (sessionId) => Promise.resolve(archived.find((record) => record.sessionId === sessionId)),
      archive: (input) => Promise.resolve({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-01-03T00:00:00.000Z" }),
      restore: () => Promise.resolve(),
      isArchived: (sessionId) => Promise.resolve(archived.some((record) => record.sessionId === sessionId)),
    },
    sessionManager: sessionGateway(records),
    heartbeatIntervalMs: 60_000,
  });
  cleanups.push(() => service.dispose());
  return { service, createAgentRuntime };
}

function texts(page: { messages: unknown[] }): string[] {
  return page.messages.map((message) => String(typeof message === "object" && message !== null ? Reflect.get(message, "content") : ""));
}

describe("reading a closed session never opens it (P3 slice d)", () => {
  it("reads a closed session's transcript page and background tasks from its file", async () => {
    const path = await file("closed.jsonl", [header("closed"), userEntry("e1", "hello")]);
    const { service, createAgentRuntime } = serviceFor([{ ...sessionRecord("closed"), path }]);

    const page = await service.messages({ id: "closed", cwd: "/workspace" }, { limit: 50 });
    const tasks = await service.backgroundTasks({ id: "closed", cwd: "/workspace" });

    expect({ texts: texts(page), tasks, opened: createAgentRuntime.mock.calls.length }).toEqual({ texts: ["hello"], tasks: [], opened: 0 });
  });

  it("reads an archived session from its archive file, for the page, the tail and the background tasks", async () => {
    const archivePath = await file("archived.jsonl", [header("old"), userEntry("e1", "from the archive")]);
    const { service, createAgentRuntime } = serviceFor([], [{ sessionId: "old", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z", archivePath }]);

    const page = await service.messages({ id: "old", cwd: "/workspace" }, { limit: 50 });
    const tail = await service.transcriptTail({ id: "old", cwd: "/workspace" }, { limit: 50 });
    const tasks = await service.backgroundTasks({ id: "old", cwd: "/workspace" });

    expect({ page: texts(page), tail: texts(tail.page), tasks, opened: createAgentRuntime.mock.calls.length }).toEqual({ page: ["from the archive"], tail: ["from the archive"], tasks: [], opened: 0 });
  });

  it("waits for a runtime still closing before it reads the file, so the close's last entries are on it", async () => {
    const path = await file("closing.jsonl", [header("closing"), userEntry("e1", "hello")]);
    const fake = fakeRuntime("closing");
    let finishDispose: () => void = () => undefined;
    fake.runtime.dispose = () => new Promise<void>((resolve) => { finishDispose = resolve; });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([{ ...sessionRecord("closing"), path }]),
      heartbeatIntervalMs: 60_000,
    });
    cleanups.push(() => { finishDispose(); return service.dispose(); });
    const ref = { id: "closing", cwd: "/workspace" };
    await service.status(ref);

    const stopping = service.stop(ref);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    let read = "pending";
    const reading = service.messages(ref).then(() => { read = "answered"; });
    await new Promise((resolve) => { setTimeout(resolve, 150); });
    const whileClosing = read;
    finishDispose();
    await stopping;
    await reading;

    expect({ whileClosing, after: read }).toEqual({ whileClosing: "pending", after: "answered" });
  });

  it("answers from the open runtime's branch, not the file, while the session is open", async () => {
    const path = await file("open.jsonl", [header("open"), userEntry("e1", "what the file holds")]);
    const fake = fakeRuntime("open", {});
    fake.session.sessionManager.getBranch = () => [{ type: "message", id: "live", parentId: null, timestamp: "2026-01-01T00:00:02.000Z", message: { role: "user", content: "what the runtime holds", timestamp: 2 } }];
    const createAgentRuntime = vi.fn(runtimeCreator(fake.runtime));
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime,
      sessionManager: sessionGateway([{ ...sessionRecord("open"), path }]),
      heartbeatIntervalMs: 60_000,
    });
    cleanups.push(() => service.dispose());
    await service.status({ id: "open", cwd: "/workspace" });

    const page = await service.messages({ id: "open", cwd: "/workspace" }, { limit: 50 });

    expect({ texts: texts(page), opened: createAgentRuntime.mock.calls.length }).toEqual({ texts: ["what the runtime holds"], opened: 1 });
  });

  it("reads the session file of an archived record that names no archive file", async () => {
    const path = await file("legacy.jsonl", [header("legacy"), userEntry("e1", "still in place")]);
    const { service, createAgentRuntime } = serviceFor([{ ...sessionRecord("legacy"), path }], [{ sessionId: "legacy", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z" }]);

    const page = await service.messages({ id: "legacy", cwd: "/workspace" }, { limit: 50 });

    expect({ texts: texts(page), opened: createAgentRuntime.mock.calls.length }).toEqual({ texts: ["still in place"], opened: 0 });
  });

  it("answers session-not-found for a session no store holds, without opening anything", async () => {
    const { service, createAgentRuntime } = serviceFor([]);

    const outcomes = await Promise.all([
      service.messages({ id: "gone", cwd: "/workspace" }).then(() => "answered", (error: unknown) => (error instanceof SessionNotFoundError ? "session-not-found" : String(error))),
      service.backgroundTasks({ id: "gone", cwd: "/workspace" }).then(() => "answered", (error: unknown) => (error instanceof SessionNotFoundError ? "session-not-found" : String(error))),
    ]);

    expect({ outcomes, opened: createAgentRuntime.mock.calls.length }).toEqual({ outcomes: ["session-not-found", "session-not-found"], opened: 0 });
  });
});
