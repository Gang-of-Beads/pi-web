/* eslint-disable @typescript-eslint/consistent-type-assertions -- review repro fixture: stubs reach into private runtime shapes; rewritten as a permanent test when its phase removes it.fails */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryCredentialStore, createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager, SettingsManager, createAgentSession } from "@earendil-works/pi-coding-agent";
import { PiSessionService, type PiSessionRuntime } from "./piSessionService.js";
import { CapturingSessionEventHub, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

/**
 * Review lane "ordering": the real SDK AgentSession (faux model, no network)
 * under the daemon. The daemon judges "idle" from session.isStreaming, which the
 * SDK sets only inside _runAgentPrompt, after the prompt preflight awaits.
 */
async function realSession(tokensPerSecond: number) {
  const cwd = await mkdtemp(join(tmpdir(), "sdk-race-"));
  const faux = createFauxCore({ provider: "faux", api: "faux-api", tokensPerSecond });
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerProvider("faux", {
    name: "Faux", baseUrl: "http://faux.invalid", apiKey: "faux-key", api: "faux-api",
    streamSimple: faux.streamSimple,
    models: [{ id: "faux-1", name: "faux-1", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
  });
  const model = modelRuntime.getModel("faux", "faux-1");
  if (model === undefined) throw new Error("faux model missing");
  const { session } = await createAgentSession({
    cwd, agentDir: join(cwd, "agent"), modelRuntime, model, noTools: "all",
    sessionManager: SessionManager.inMemory(cwd), settingsManager: SettingsManager.inMemory(),
  });
  faux.setResponses([fauxAssistantMessage("reply one with a few words to stream"), fauxAssistantMessage("reply two with a few words to stream"), fauxAssistantMessage("reply three")]);
  const consumed: string[] = [];
  session.subscribe((event) => {
    if (event.type === "message_start" && event.message.role === "user") {
      const content = event.message.content;
      consumed.push(typeof content === "string" ? content : content.map((part) => part.type === "text" ? part.text : "[image]").join(""));
    }
  });
  return { session, consumed };
}

async function daemonOverRealSdk(id: string, tokensPerSecond: number) {
  const real = await realSession(tokensPerSecond);
  const cwd = real.session.sessionManager.getCwd();
  const runtime = { cwd, session: real.session, setRebindSession: () => undefined, fork: () => Promise.resolve({ cancelled: false }), dispose: () => Promise.resolve() } as unknown as PiSessionRuntime;
  const hub = new CapturingSessionEventHub();
  const svc = new PiSessionService(hub, {
    agentDir: "/tmp/pi-web-test-agent",
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(runtime),
    sessionManager: sessionGateway([sessionRecord(id, cwd)]),
    heartbeatIntervalMs: 60_000,
  });
  const accepted = () => hub.sessionEvents.filter(({ event }) => event.type === "prompt.accepted").map(({ event }) => String(Reflect.get(event, "clientMessageId")));
  const errors = () => [...new Set(hub.sessionEvents.filter(({ event }) => event.type === "session.error").map(({ event }) => String(Reflect.get(event, "message"))))];
  return { ...real, hub, svc, ref: sessionRef(id, cwd), accepted, errors };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function photo() {
  return (await readFile("docs/assets/pi-web-banner.png")).toString("base64");
}

/**
 * Pinned SDK behaviour the daemon's inbox works around: the SDK refuses a second prompt handed
 * to a session whose first run has not passed preflight, and a refused concurrent prompt clears
 * `isStreaming` mid-run. These stay `it.fails` on purpose - they fail as long as the SDK behaves
 * this way, and an upgrade that changes it turns them red so the workaround gets re-examined.
 */
describe("SDK behaviour the daemon works around", () => {
  it.fails("S1: two prompts handed to an idle session with no delivery kind are both consumed", async () => {
    const { session, consumed } = await realSession(200);
    const outcomes: string[] = [];
    const first = session.prompt("A first").then(() => outcomes.push("A ok"), (error: unknown) => outcomes.push(`A refused: ${String(error)}`));
    await Promise.resolve();
    const second = session.prompt("B second").then(() => outcomes.push("B ok"), (error: unknown) => outcomes.push(`B refused: ${String(error)}`));
    await Promise.all([first, second]);
    expect({ consumed, outcomes }).toEqual({ consumed: ["A first", "B second"], outcomes: ["A ok", "B ok"] });
  });

  it.fails("S2: isStreaming stays true while a run streams, even after a refused concurrent prompt", async () => {
    const { session } = await realSession(200);
    const first = session.prompt("A first");
    await Promise.resolve();
    await session.prompt("B second").catch(() => undefined);
    const midRun = { isStreaming: session.isStreaming };
    await first;
    expect(midRun).toEqual({ isStreaming: true });
  });
});

/**
 * SDK state the daemon inbox reads directly. An upgrade that renames or removes any of it must
 * fail here, not silently re-open the windows the inbox closes with it.
 */
describe("SDK state the daemon reads", () => {
  it("exposes the agent_settled deferral flag, the agent loop's own flag, and the in-memory steering mode", async () => {
    const { session } = await realSession(200);
    session.agent.steeringMode = "all";
    const emittingSettled: unknown = Reflect.get(session, "_isEmittingAgentSettled");
    const queuePeeks = ["steeringQueue", "followUpQueue"].map((name): unknown => {
      const queue: unknown = Reflect.get(session.agent, name);
      const peek: unknown = typeof queue === "object" && queue !== null ? Reflect.get(queue, "peek") : undefined;
      return typeof peek === "function" ? Reflect.apply(peek, queue, []) : "missing";
    });
    expect(queuePeeks).toEqual([[], []]);
    expect({
      emittingSettled,
      loopStreaming: session.agent.state.isStreaming,
      steeringMode: session.agent.steeringMode,
    }).toEqual({ emittingSettled: false, loopStreaming: false, steeringMode: "all" });
  });
});

describe("daemon over the real SDK: idle session, sequential sends (outbox replay awaits each answer)", () => {
  it("D1: photo then text, fast model: consumed in acceptance order", async () => {
    const { svc, consumed, session, ref, accepted, errors } = await daemonOverRealSdk("real-photo-fast", 200);
    await svc.prompt(ref, "A with photo", undefined, [{ kind: "image", mimeType: "image/png", data: await photo() }], { clientMessageId: "aaaa-0001" });
    await svc.prompt(ref, "B text", undefined, undefined, { clientMessageId: "bbbb-0002" });
    for (let tries = 0; tries < 200 && (session.isStreaming || consumed.length < 2); tries += 1) await sleep(25);
    expect({ accepted: accepted(), consumed, errors: errors() }).toEqual({ accepted: ["aaaa-0001", "bbbb-0002"], consumed: ["A with photo[image]", "B text"], errors: [] });
    await svc.dispose();
  });

  it("D2: photo then text, slow model: the photo is not refused after it was accepted, and the session does not read idle mid-run", async () => {
    const { svc, hub, consumed, session, ref, accepted, errors } = await daemonOverRealSdk("real-photo-slow", 4);
    await svc.prompt(ref, "A with photo", undefined, [{ kind: "image", mimeType: "image/png", data: await photo() }], { clientMessageId: "aaaa-0001" });
    await svc.prompt(ref, "B text", undefined, undefined, { clientMessageId: "bbbb-0002" });
    await sleep(600);
    const photoFrames = hub.sessionEvents.filter(({ event }) => Reflect.get(event, "clientMessageId") === "aaaa-0001").map(({ event }) => event.type);
    const midRun = { photoFrames, consumed: [...consumed], isStreaming: session.isStreaming, statusStreaming: (await svc.status(ref)).isStreaming, errors: errors() };
    expect({ accepted: accepted(), ...midRun }).toEqual({ accepted: ["aaaa-0001", "bbbb-0002"], photoFrames: ["prompt.accepted", "message.append"], consumed: ["A with photo[image]"], isStreaming: true, statusStreaming: true, errors: [] });
    await svc.dispose();
  });
});
