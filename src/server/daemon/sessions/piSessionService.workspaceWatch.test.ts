import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiAgentSession } from "./piSessionService.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

interface WatchSpies {
  hold: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

function spyWatcher(service: PiSessionService): WatchSpies {
  const watcher: unknown = Reflect.get(service, "workspaceWatcher");
  if (!isWatcher(watcher)) throw new Error("PiSessionService.workspaceWatcher is not a WorkspaceWatcher");
  return { hold: vi.spyOn(watcher, "hold"), release: vi.spyOn(watcher, "release") };
}

function isWatcher(value: unknown): value is { hold: (sessionId: string, cwd: string) => void; release: (sessionId: string, cwd: string) => void } {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "hold") === "function" && typeof Reflect.get(value, "release") === "function";
}

function serviceWith(runtime: ReturnType<typeof fakeRuntime>["runtime"]): PiSessionService {
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(runtime),
    sessionManager: sessionGateway([]),
    heartbeatIntervalMs: 60_000,
  });
  cleanups.push(() => service.dispose());
  return service;
}

describe("workspace watch holds follow the session a runtime is bound to", () => {
  it("holds on open and releases on close under the canonical working directory", async () => {
    const fake = fakeRuntime("session-1");
    const service = serviceWith(fake.runtime);
    const spies = spyWatcher(service);

    await service.start("/workspace/");
    expect(spies.hold).toHaveBeenCalledWith("session-1", "/workspace");

    await service.stop({ id: "session-1", cwd: "/workspace" });
    expect(spies.release).toHaveBeenCalledWith("session-1", "/workspace");
  });

  it("moves the hold to the replacement session when the SDK runtime rebinds", async () => {
    const fake = fakeRuntime("session-1");
    const replacement = fakeRuntime("session-2");
    let rebindSession: ((session: PiAgentSession) => Promise<void>) | undefined;
    fake.runtime.setRebindSession = (callback) => { rebindSession = callback; };
    const service = serviceWith(fake.runtime);
    const spies = spyWatcher(service);

    await service.start("/workspace");
    Object.defineProperty(fake.runtime, "session", { configurable: true, value: replacement.session });
    await rebindSession?.(replacement.session);

    expect(spies.release).toHaveBeenCalledWith("session-1", "/workspace");
    expect(spies.hold).toHaveBeenLastCalledWith("session-2", "/workspace");
  });
});
