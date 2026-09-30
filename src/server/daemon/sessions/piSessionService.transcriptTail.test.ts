import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, testModelRuntime } from "./piSessionService.testSupport.js";
import { SessionNotFoundError } from "./sessionErrors.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function serviceFor(records: ReturnType<typeof sessionRecord>[], createAgentRuntime: NonNullable<ConstructorParameters<typeof PiSessionService>[1]["createAgentRuntime"]>, hub = new CapturingSessionEventHub()): PiSessionService {
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

async function sessionFile(lines: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-tail-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "s1.jsonl");
  await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return path;
}

const header = { type: "session", version: 3, id: "s1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" };
const entry = (id: string, parentId: string | null, role: "user" | "assistant", text: string) => ({
  type: "message",
  id,
  parentId,
  timestamp: "2026-01-01T00:00:01.000Z",
  message: role === "user" ? { role, content: text, timestamp: 1 } : { role, content: [{ type: "text", text }], timestamp: 2 },
});
const branchedFile = [
  header,
  entry("e1", null, "user", "hello"),
  entry("e2", "e1", "assistant", "an answer the reader went back from"),
  { type: "branch_summary", id: "b1", parentId: "e1", timestamp: "2026-01-01T00:00:02.000Z", fromId: "e2", summary: "went back" },
  entry("e3", "b1", "assistant", "the answer in use"),
];

const SUMMARY_ROW = "Branch summary:\n\nwent back";

function texts(page: { messages: unknown[] } | undefined): string[] {
  return (page?.messages ?? []).flatMap((message) => {
    const content: unknown = typeof message === "object" && message !== null ? Reflect.get(message, "content") : undefined;
    if (typeof content === "string") return [content];
    return Array.isArray(content) ? content.flatMap((part: unknown) => (typeof part === "object" && part !== null && typeof Reflect.get(part, "text") === "string" ? [String(Reflect.get(part, "text"))] : [])) : [];
  });
}

describe("the first transcript page, without waiting for the runtime (P2 slice c)", () => {
  it("reads a closed session from its file, on the branch in use, and opens no runtime", async () => {
    const path = await sessionFile(branchedFile);
    const createAgentRuntime = vi.fn(() => Promise.reject(new Error("a tail read must not open a runtime")));
    const service = serviceFor([{ ...sessionRecord("s1"), path }], createAgentRuntime);

    const tail = await service.transcriptTail({ id: "s1", cwd: "/workspace" }, { limit: 50 });

    expect({ texts: texts(tail.page), total: tail.page.total, partial: tail.stream.partial, opened: createAgentRuntime.mock.calls.length }).toEqual({
      texts: ["hello", SUMMARY_ROW, "the answer in use"],
      total: 3,
      partial: null,
      opened: 0,
    });
  });

  it("stamps the page with the stream position of the session the file holds", async () => {
    const path = await sessionFile(branchedFile);
    const hub = new CapturingSessionEventHub();
    hub.setSeq("s1", 41);
    const service = serviceFor([{ ...sessionRecord("s1"), path }], () => Promise.reject(new Error("no runtime")), hub);

    const tail = await service.transcriptTail({ id: "s1", cwd: "/workspace" });

    expect(tail.stream.seq).toBe(41);
  });

  it("answers an open session from memory, with its stream position", async () => {
    const fake = fakeRuntime("s1");
    const service = serviceFor([sessionRecord("s1")], runtimeCreator(fake.runtime));
    await service.status({ id: "s1", cwd: "/workspace" });

    const tail = await service.transcriptTail({ id: "s1", cwd: "/workspace" });

    expect({ total: tail.page.total, hasSeq: typeof tail.stream.seq === "number", partial: tail.stream.partial }).toEqual({ total: 0, hasSeq: true, partial: null });
  });

  it("finds an open session by the start of its id, and answers it from memory", async () => {
    const partial = { role: "assistant", content: [{ type: "text", text: "still writing" }], timestamp: 3 };
    const path = await sessionFile([{ ...header, id: "s1-long-id" }, entry("e1", null, "user", "hello")]);
    const fake = fakeRuntime("s1-long-id", { state: { streamingMessage: partial } });
    const service = serviceFor([{ ...sessionRecord("s1-long-id"), path }], runtimeCreator(fake.runtime));
    await service.status({ id: "s1-long-id", cwd: "/workspace" });

    const byPrefix = await service.transcriptTail({ id: "s1-long", cwd: "/workspace" });

    expect(byPrefix.stream.partial).not.toBeNull();
  });

  it("reads a file of an older version through the runtime, which migrates it", async () => {
    const path = await sessionFile([{ ...header, version: 2 }, ...branchedFile.slice(1)]);
    const fake = fakeRuntime("s1");
    const createAgentRuntime = vi.fn(runtimeCreator(fake.runtime));
    const service = serviceFor([{ ...sessionRecord("s1"), path }], createAgentRuntime);

    await service.transcriptTail({ id: "s1", cwd: "/workspace" });

    expect(createAgentRuntime).toHaveBeenCalledTimes(1);
  });

  it("pages a version 1 file through the plugin port as the SDK would migrate it", async () => {
    const path = await sessionFile([
      { type: "session", id: "s1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" },
      { type: "message", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "an old hello", timestamp: 1 } },
      { type: "message", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "an old answer" }], timestamp: 2 } },
    ]);
    const service = serviceFor([{ ...sessionRecord("s1"), path }], () => Promise.reject(new Error("no runtime")));

    const page = await service.messagesPassive({ id: "s1", cwd: "/workspace" });

    expect(texts(page)).toEqual(["an old hello", "an old answer"]);
  });

  it("answers a session no store holds with the typed error", async () => {
    const service = serviceFor([], () => Promise.reject(new Error("no runtime")));

    await expect(service.transcriptTail({ id: "deleted", cwd: "/workspace" })).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it("pages only the branch in use through the plugin transcript port too", async () => {
    const path = await sessionFile(branchedFile);
    const service = serviceFor([{ ...sessionRecord("s1"), path }], () => Promise.reject(new Error("no runtime")));

    const page = await service.messagesPassive({ id: "s1", cwd: "/workspace" });

    expect(texts(page)).toEqual(["hello", SUMMARY_ROW, "the answer in use"]);
  });
});
