import { describe, expect, it, vi } from "vitest";
import { createPiWebCustomToolDefinitions, PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModel, testModelRuntime } from "./piSessionService.testSupport.js";

/**
 * Owner, 2026-09-30: "pi web should not give the AI any extra tools; those should all be defined by the user's own plugins".
 * Delegation is a session route now (docs/design/no-builtin-agent-tools.md): the
 * agent gets no spawn or subsession tool from PI WEB, and a route passes the
 * parent's identity, model and thinking level exactly as the retired tools did.
 */
describe("PI WEB's own tools", () => {
  it("are only pi's edit, with nothing added", () => {
    expect(createPiWebCustomToolDefinitions("/workspace").map((definition) => definition.name)).toEqual(["edit"]);
  });
});

async function parentService() {
  const model = testModel();
  const parent = fakeRuntime("parent-7", { sessionFile: "/sessions/parent-7.jsonl", model, thinkingLevel: "high", sessionManager: fakeSessionManager("/workspace", { getSessionId: () => "parent-7", getSessionFile: () => "/sessions/parent-7.jsonl" }) });
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: "/tmp/pi-web-test-agent",
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(parent.runtime),
    sessionManager: sessionGateway([sessionRecord("parent-7")]),
    archiveStore: emptyArchiveStore(),
    spawnTargets: { resolveSpawnTarget: () => Promise.resolve({ allowed: true, cwd: "/workspace" }) },
    heartbeatIntervalMs: 60_000,
  });
  await service.status(sessionRef("parent-7"));
  return { service, model };
}

describe("the delegation routes", () => {
  it("start an independent session with the parent's identity, model and requested model", async () => {
    const { service, model } = await parentService();
    const spawn = vi.spyOn(service, "spawnSession").mockResolvedValue({ sessionId: "independent-1", cwd: "/workspace-b" });

    await service.spawnFromSession(sessionRef("parent-7"), { prompt: "go", model: "openai/gpt-5", cwd: "/workspace-b" });

    expect(spawn).toHaveBeenCalledWith({
      spawningCwd: "/workspace",
      spawningSessionId: "parent-7",
      prompt: "go",
      cwd: "/workspace-b",
      model,
      modelSpec: "openai/gpt-5",
      thinkingLevel: "high",
    });
    await service.dispose();
  });

  it("start a tracked child with the parent's identity, file, model and thinking level", async () => {
    const { service, model } = await parentService();
    const spawn = vi.spyOn(service, "spawnSubsession").mockResolvedValue({ sessionId: "child-1", cwd: "/workspace" });

    await service.spawnSubsessionFromSession(sessionRef("parent-7"), { prompt: "go" });

    expect(spawn).toHaveBeenCalledWith({
      spawningCwd: "/workspace",
      parentSessionId: "parent-7",
      parentSessionFile: "/sessions/parent-7.jsonl",
      prompt: "go",
      model,
      thinkingLevel: "high",
    });
    await service.dispose();
  });
});
