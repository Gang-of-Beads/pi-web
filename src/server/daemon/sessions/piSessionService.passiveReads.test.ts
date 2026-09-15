import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, sessionGateway, sessionRecord, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function serviceFor(records: ReturnType<typeof sessionRecord>[], createAgentRuntime = vi.fn(() => Promise.reject(new Error("a passive read must not open a runtime")))): PiSessionService {
  const hub = new CapturingSessionEventHub();
  const service = new PiSessionService(hub, {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    createAgentRuntime,
    sessionManager: sessionGateway(records),
    heartbeatIntervalMs: 60_000,
  });
  cleanups.push(() => service.dispose());
  return service;
}

describe("passive transcript reads", () => {
  it("lists a working directory's sessions without reconciling unread or activity state", async () => {
    const service = serviceFor([sessionRecord("s1"), sessionRecord("s2")]);
    const unreadStore: unknown = Reflect.get(service, "unreadStore");
    if (!isReconciling(unreadStore)) throw new Error("PiSessionService.unreadStore is not the reconciling store");
    const reconcile = vi.spyOn(unreadStore, "reconcileCwd");

    const listed = await service.listPassive("/workspace");

    expect(listed.map((session) => session.id)).toEqual(["s1", "s2"]);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("pages a closed session from its file without opening a runtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-passive-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, "s1.jsonl");
    const lines = [
      JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" }),
      JSON.stringify({ type: "message", id: "e1", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "hello", timestamp: 1 } }),
      JSON.stringify({ type: "message", id: "e2", parentId: "e1", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 2 } }),
    ];
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");
    const createAgentRuntime = vi.fn(() => Promise.reject(new Error("must not open")));
    const service = serviceFor([{ ...sessionRecord("s1"), path }], createAgentRuntime);

    const page = await service.messagesPassive({ id: "s1", cwd: "/workspace" }, { limit: 10 });

    expect(page?.total).toBe(2);
    expect(page?.messages).toHaveLength(2);
    expect(createAgentRuntime).not.toHaveBeenCalled();
  });

  it("answers undefined for an unknown session or an unreadable file, never an empty page", async () => {
    const service = serviceFor([{ ...sessionRecord("s1"), path: "/nowhere/s1.jsonl" }]);

    await expect(service.messagesPassive({ id: "missing", cwd: "/workspace" })).resolves.toBeUndefined();
    await expect(service.messagesPassive({ id: "s1", cwd: "/workspace" })).resolves.toBeUndefined();
  });
});

function isReconciling(value: unknown): value is { reconcileCwd: (cwd: string, ids: readonly string[]) => unknown } {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "reconcileCwd") === "function";
}
