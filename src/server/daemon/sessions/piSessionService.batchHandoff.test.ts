/* eslint-disable @typescript-eslint/consistent-type-assertions -- the real SDK session is wrapped as the daemon's runtime without the host's runtime factory */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryCredentialStore, createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager, SettingsManager, createAgentSession } from "@earendil-works/pi-coding-agent";
import { PiSessionService, type PiSessionRuntime } from "./piSessionService.js";
import { OwnedPromptQueue, dataDirInboxLocation } from "./ownedPromptQueue.js";
import { CapturingSessionEventHub, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

/**
 * B33, D1 in docs/design/state-diagram.md. Owner, 2026-09-30: queued messages are held only so
 * one can be taken back; at an injection point every one of them is handed at once. Measured
 * before the fix (product audit 5d672be6): three messages sent during a long reply became three
 * separate model requests, 16-20 ms apart, each answered on its own.
 *
 * The real SDK under the daemon, with a faux model that records the user messages each request
 * carries.
 */
async function daemonOverRealSdk(options: { dataDir?: string; cwd?: string; seed?: (sessionId: string, cwd: string) => Promise<void> } = {}) {
  const cwd = options.cwd ?? await mkdtemp(join(tmpdir(), "batch-handoff-"));
  const faux = createFauxCore({ provider: "faux", api: "faux-api", tokensPerSecond: 40 });
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerProvider("faux", {
    name: "Faux", baseUrl: "http://faux.invalid", apiKey: "faux-key", api: "faux-api",
    streamSimple: faux.streamSimple,
    models: [{ id: "faux-1", name: "faux-1", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
  });
  const model = modelRuntime.getModel("faux", "faux-1");
  if (model === undefined) throw new Error("faux model missing");
  const { session } = await createAgentSession({
    cwd, agentDir: join(cwd, "agent"), modelRuntime, model, noTools: "all",
    sessionManager: SessionManager.inMemory(cwd), settingsManager: SettingsManager.inMemory(),
  });
  const requests: string[][] = [];
  let answered = 0;
  const answer = (context: { messages: readonly unknown[] }) => {
    const lastReply = context.messages.map((message): unknown => Reflect.get(Object(message), "role")).lastIndexOf("assistant");
    const fresh = context.messages.slice(lastReply + 1).filter((message) => Reflect.get(Object(message), "role") === "user").map((message) => userText(message));
    if (fresh.some((text) => text.startsWith("Create a 2-6 word title"))) return fauxAssistantMessage("a title");
    requests.push(fresh);
    answered += 1;
    return fauxAssistantMessage(answered === 1 ? "a long first reply that streams for a while so the other messages wait for it" : "ok");
  };
  faux.setResponses(Array.from({ length: 8 }, () => answer));
  const id = session.sessionId;
  await options.seed?.(id, cwd);
  const runtime = { cwd, session, setRebindSession: () => undefined, fork: () => Promise.resolve({ cancelled: false }), dispose: () => Promise.resolve() } as unknown as PiSessionRuntime;
  const svc = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: "/tmp/pi-web-test-agent",
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(runtime),
    sessionManager: sessionGateway([sessionRecord(id, cwd)]),
    heartbeatIntervalMs: 60_000,
    ...(options.dataDir === undefined ? {} : { operationLedgerDir: options.dataDir }),
  });
  return { svc, session, requests, ref: sessionRef(id, cwd) };
}

function userText(message: unknown): string {
  const content: unknown = Reflect.get(Object(message), "content");
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((part) => String(Reflect.get(Object(part), "text") ?? "")).join("") : "";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("messages that waited for a run", () => {
  /**
   * The idle injection point (B33, first commit): messages the inbox kept through a daemon
   * restart are handed together when the session reopens idle. Before, each started a run of
   * its own.
   */
  it("reach the model together when the session reopens after a restart", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "batch-restart-"));
    const dataDir = await mkdtemp(join(tmpdir(), "batch-restart-data-"));
    const seed = async (sessionId: string, sessionCwd: string) => {
      const inbox = new OwnedPromptQueue(dataDirInboxLocation(dataDir));
      for (const [index, text] of ["A first", "B second", "C third"].entries()) {
        await inbox.push(sessionId, sessionCwd, { clientMessageId: `rest-000${String(index)}`, lane: "steer", text, images: [], acceptedAt: new Date(Date.UTC(2026, 8, 30, 9, 0, index)).toISOString(), echoUserMessage: true });
      }
    };
    const { svc, session, requests } = await daemonOverRealSdk({ cwd, dataDir, seed });
    expect(await svc.resumeWaitingInboxes()).toEqual([session.sessionId]);
    for (let tries = 0; tries < 200 && (session.isStreaming || requests.flat().length < 3); tries += 1) await sleep(25);
    await sleep(200);

    expect(requests).toEqual([["A first", "B second", "C third"]]);
    expect(svc.operationOutcomes(session.sessionId, ["rest-0000", "rest-0001", "rest-0002"])).toEqual({ "rest-0000": "succeeded", "rest-0001": "succeeded", "rest-0002": "succeeded" });
    expect((await svc.status(sessionRef(session.sessionId, cwd))).queuedMessages).toEqual([]);
    await svc.dispose();
  }, 20_000);

  /**
   * While the agent runs (B33, second commit): every message accepted during a reply is in pi's
   * lane before pi next polls it, so they reach the next request together. Before, they were held
   * until a gap and handed one at a time, each awaiting pi's input preflight, and straddled pi's
   * final check: A; then B and C; then D alone.
   */
  it("sent while a reply streams, reach the next request together, in the order they were sent", async () => {
    const { svc, session, requests, ref } = await daemonOverRealSdk();
    await svc.prompt(ref, "A first", undefined, undefined, { clientMessageId: "run-0001" });
    for (let tries = 0; tries < 100 && !session.isStreaming; tries += 1) await sleep(10);
    await svc.prompt(ref, "B second", undefined, undefined, { clientMessageId: "run-0002" });
    await svc.prompt(ref, "C third", undefined, undefined, { clientMessageId: "run-0003" });
    await svc.prompt(ref, "D fourth", undefined, undefined, { clientMessageId: "run-0004" });
    for (let tries = 0; tries < 600 && (session.isStreaming || requests.flat().length < 4); tries += 1) await sleep(25);
    await sleep(200);

    expect(requests).toEqual([["A first"], ["B second", "C third", "D fourth"]]);
    expect(svc.operationOutcomes(session.sessionId, ["run-0002", "run-0003", "run-0004"])).toEqual({ "run-0002": "succeeded", "run-0003": "succeeded", "run-0004": "succeeded" });
    await svc.dispose();
  }, 30_000);
});
