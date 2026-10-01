import { afterEach, describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, testModelRuntime } from "./piSessionService.testSupport.js";
import { SessionNotFoundError } from "./sessionErrors.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

interface ArchivedFixture {
  sessionId: string;
  cwd: string;
  archivedAt: string;
}

function serviceFor(records: ReturnType<typeof sessionRecord>[], archived: ArchivedFixture[] = [], createAgentRuntime: ConstructorParameters<typeof PiSessionService>[1]["createAgentRuntime"] = () => Promise.reject(new Error("locating a session must not open a runtime"))): PiSessionService {
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
  return service;
}

describe("stopping a session with no runtime (P2 slice b part 2, G5)", () => {
  it("answers Stop and Abort on a session no store holds with the typed error, and quietly for one that exists", async () => {
    const service = serviceFor([sessionRecord("closed")]);

    const outcomes = await Promise.all([
      service.abort({ id: "deleted", cwd: "/workspace" }).then(() => "answered", (error: unknown) => (error instanceof SessionNotFoundError ? "session-not-found" : "other failure")),
      service.stop({ id: "deleted", cwd: "/workspace" }).then(() => "answered", (error: unknown) => (error instanceof SessionNotFoundError ? "session-not-found" : "other failure")),
      service.abort({ id: "closed", cwd: "/workspace" }).then((answer) => JSON.stringify(answer), () => "failed"),
      service.stop({ id: "closed", cwd: "/workspace" }).then(() => "answered", () => "failed"),
    ]);

    expect(outcomes).toEqual(["session-not-found", "session-not-found", JSON.stringify({ discarded: [] }), "answered"]);
  });
});

describe("locating a session by id (P2 slice b)", () => {
  it("finds a session recorded under another directory than the one asked about", async () => {
    const service = serviceFor([sessionRecord("in-sub", "/workspace/packages/app")]);

    await expect(service.locate({ id: "in-sub", cwd: "/workspace" })).resolves.toMatchObject({ id: "in-sub", cwd: "/workspace/packages/app" });
  });

  it("says an archived session is archived", async () => {
    const service = serviceFor([sessionRecord("old", "/workspace/packages/app")], [{ sessionId: "old", cwd: "/workspace/packages/app", archivedAt: "2026-01-02T00:00:00.000Z" }]);

    await expect(service.locate({ id: "old", cwd: "/workspace" })).resolves.toMatchObject({ id: "old", archived: true, archivedAt: "2026-01-02T00:00:00.000Z" });
  });

  it("answers a session no store holds with the typed error", async () => {
    const service = serviceFor([sessionRecord("s1")]);

    await expect(service.locate({ id: "deleted", cwd: "/workspace" })).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it("finds a new session that is open but not written to disk yet", async () => {
    const fake = fakeRuntime("fresh-session");
    const service = serviceFor([], [], runtimeCreator(fake.runtime));
    await service.start("/workspace");

    await expect(service.locate({ id: "fresh-session", cwd: "/workspace" })).resolves.toMatchObject({ id: "fresh-session", cwd: "/workspace", persisted: false });
  });

  it("says a session named by the start of its id is archived when it is", async () => {
    const service = serviceFor([sessionRecord("old-session-id", "/workspace/packages/app")], [{ sessionId: "old-session-id", cwd: "/workspace/packages/app", archivedAt: "2026-01-02T00:00:00.000Z" }]);

    await expect(service.locate({ id: "old-session", cwd: "/workspace" })).resolves.toMatchObject({ id: "old-session-id", archived: true });
  });
});
