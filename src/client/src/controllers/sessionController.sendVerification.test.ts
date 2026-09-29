// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, status, workspace, type AppState } from "./sessionController.testSupport";
import { loadPendingPrompts, savePendingPrompt } from "../pendingOutbox";
import { VERIFY_AFTER_MS } from "../sendVerification";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

const outboxKey = `local:${oldSession.id}`;

/** The ledger's answer to one ask, given the ids asked about; undefined when asking fails. */
type LedgerAnswers = (ids: readonly string[], ask: number) => Record<string, string> | undefined;

async function unansweredSend(answer: LedgerAnswers) {
  let state: AppState = {
    ...initialAppState(),
    selectedWorkspace: workspace,
    selectedSession: oldSession,
    sessions: [oldSession],
    status: status(oldSession.id),
    sessionStatuses: { [oldSession.id]: status(oldSession.id) },
  };
  const asked: string[][] = [];
  const api: typeof defaultApi = {
    ...defaultApi,
    prompt: () => Promise.reject(new TypeError("Failed to fetch")),
    operationOutcomes: (_session, ids) => {
      asked.push([...ids]);
      const answered = answer(ids, asked.length);
      return answered === undefined ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(answered);
    },
  };
  const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new FakeSocket() });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await controller.send("no answer came").catch(() => undefined);
  const id = state.messages.find((line) => line.role === "user")?.meta?.delivery?.clientMessageId;
  if (id === undefined) throw new Error("the send needs a row");
  savePendingPrompt(outboxKey, { text: "no answer came", clientMessageId: id, at: new Date().toISOString(), state: "unverified" });
  return {
    controller,
    id,
    asked,
    rows: () => state.messages.filter((line) => line.role === "user").map((line) => line.meta?.delivery?.state),
    outbox: () => loadPendingPrompts(outboxKey).map((prompt) => prompt.clientMessageId),
  };
}

const each = (outcome: string): LedgerAnswers => (ids) => Object.fromEntries(ids.map((id) => [id, outcome]));

describe("an unanswered send asks the daemon's ledger on its own", () => {
  it("asks nothing at once, then five seconds after the send gave up", async () => {
    const send = await unansweredSend(() => ({}));
    expect(send.asked).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[0] ?? 0);
    expect({ asked: send.asked, rows: send.rows() }).toEqual({ asked: [[send.id]], rows: ["unverifiable"] });
  });

  it("marks the row received and lets the outbox go when the ledger holds the message", async () => {
    const send = await unansweredSend(each("pending"));
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[0] ?? 0);
    expect({ rows: send.rows(), outbox: send.outbox() }).toEqual({ rows: ["received"], outbox: [] });
  });

  it("waits while the daemon has no row, and says not received on the last ask", async () => {
    const send = await unansweredSend(() => ({}));
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[1] ?? 0);
    expect({ asked: send.asked.length, rows: send.rows() }).toEqual({ asked: 2, rows: ["unverifiable"] });
    await vi.advanceTimersByTimeAsync((VERIFY_AFTER_MS[2] ?? 0) - (VERIFY_AFTER_MS[1] ?? 0));
    expect({ asked: send.asked.length, rows: send.rows(), outbox: send.outbox() }).toEqual({ asked: 3, rows: ["failed"], outbox: [send.id] });
  });

  it("takes a withdrawn message off the transcript and out of the outbox", async () => {
    const send = await unansweredSend(each("withdrawn"));
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[0] ?? 0);
    expect({ rows: send.rows(), outbox: send.outbox() }).toEqual({ rows: [], outbox: [] });
  });

  it("asks at once when the tab comes back", async () => {
    const send = await unansweredSend(each("succeeded"));
    await send.controller.verifyUnansweredSends();
    expect({ asked: send.asked.length, rows: send.rows() }).toEqual({ asked: 1, rows: ["received"] });
  });

  it("leaves the row open and honest when asking fails too", async () => {
    const send = await unansweredSend(() => undefined);
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[2] ?? 0);
    expect({ asked: send.asked.length, rows: send.rows() }).toEqual({ asked: 3, rows: ["unverifiable"] });
  });
});
