// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, status, workspace, type AppState } from "./sessionController.testSupport";
import { loadPendingPrompts, savePendingPrompt } from "../pendingOutbox";
import type { ChatLine } from "../components/shared";
import { VERIFY_AFTER_MS, VERIFY_RETRY_MS, messageStatusUnanswered } from "../sendVerification";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

const outboxKey = `local:${oldSession.id}`;

/** The ledger's answer to one ask, given the ids asked about; undefined when asking fails. */
type LedgerAnswers = (ids: readonly string[], ask: number) => Record<string, string> | undefined;

async function unansweredSend(answer: LedgerAnswers, overrides: Partial<typeof defaultApi> = {}) {
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
    ...overrides,
  };
  let normalize: ((line: ChatLine) => ChatLine) | undefined;
  const write = (patch: Partial<AppState>): void => {
    const messages = patch.messages !== undefined && normalize !== undefined ? patch.messages.map(normalize) : patch.messages;
    normalize = undefined;
    state = { ...state, ...patch, ...(messages === undefined ? {} : { messages }) };
  };
  const controller = new SessionController(() => state, write, () => undefined, undefined, { api, socket: new FakeSocket() });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await controller.send("no answer came").catch(() => undefined);
  const id = state.messages.find((line) => line.role === "user")?.meta?.delivery?.clientMessageId;
  if (id === undefined) throw new Error("the send needs a row");
  savePendingPrompt(outboxKey, { text: "no answer came", clientMessageId: id, at: new Date().toISOString(), state: "unverifiable" });
  return {
    controller,
    id,
    asked,
    rows: () => state.messages.filter((line) => line.role === "user").map((line) => line.meta?.delivery?.state),
    outbox: () => loadPendingPrompts(outboxKey).map((prompt) => prompt.clientMessageId),
    records: () => loadPendingPrompts(outboxKey).map((prompt) => [prompt.state, prompt.failure, prompt.refused === true]),
    notice: () => state.error,
    row: () => messageStatusUnanswered(state.messageStatusUnanswered, { machineId: "local", sessionId: state.selectedSession?.id })?.miss.kind,
    claim: () => state.messageStatusUnanswered,
    showSession: (session: typeof oldSession) => { state = { ...state, selectedSession: session }; },
    messages: () => state.messages,
    normalizeNextWrite: (next: (line: ChatLine) => ChatLine) => { normalize = next; },
  };
}

const each = (outcome: string): LedgerAnswers => (ids) => Object.fromEntries(ids.map((id) => [id, outcome]));

describe("an unanswered send whose ledger cannot be reached", () => {
  it("keeps asking past the last scheduled ask, tells the row it is reconnecting, and settles once an ask gets through (P1 slice 6)", async () => {
    const send = await unansweredSend((ids, ask) => (ask <= 5 ? undefined : {}));
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[0] ?? 0);
    const afterFirst = { asked: send.asked.length, row: send.row(), notice: send.notice(), rows: send.rows() };
    await vi.advanceTimersByTimeAsync((VERIFY_AFTER_MS[2] ?? 0) - (VERIFY_AFTER_MS[0] ?? 0));
    const atTheLast = { asked: send.asked.length, rows: send.rows() };
    await vi.advanceTimersByTimeAsync(VERIFY_RETRY_MS);
    const through = { asked: send.asked.length, rows: send.rows(), row: send.row(), notice: send.notice() };
    await vi.advanceTimersByTimeAsync(VERIFY_RETRY_MS * 4);

    expect({ afterFirst, atTheLast, through, afterSettling: send.asked.length }).toEqual({
      afterFirst: { asked: 1, row: "link-down", notice: "", rows: ["unverifiable"] },
      atTheLast: { asked: 5, rows: ["unverifiable"] },
      through: { asked: 6, rows: ["failed"], row: undefined, notice: "" },
      afterSettling: 6,
    });
  });
});

describe("the message status claim (P1 slice 6)", () => {
  it("counts from the first unanswered moment across every retry, so the row's grace is not restarted", async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => { clock += 1_000; return clock; });
    const send = await unansweredSend(() => undefined);
    const fromTheSend = send.claim()?.since;
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[0] ?? 0);
    await vi.advanceTimersByTimeAsync(VERIFY_RETRY_MS * 2);

    expect({ asked: send.asked.length > 1, since: send.claim()?.since, fromTheSend: typeof fromTheSend }).toEqual({ asked: true, since: fromTheSend, fromTheSend: "number" });
  });
});

describe("phase 5 gate 1: asks that outlive the screen they started on", () => {
  const elsewhere = { ...oldSession, id: "another-session", path: "/tmp/another-session.jsonl" };

  it("withdraws the row's claim once the reader has left the session it was about", async () => {
    const send = await unansweredSend(() => undefined);
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[0] ?? 0);
    const raised = send.row();
    send.showSession(elsewhere);
    await vi.advanceTimersByTimeAsync(VERIFY_RETRY_MS);

    expect({ raised, afterLeaving: send.claim(), notice: send.notice() }).toEqual({ raised: "link-down", afterLeaving: undefined, notice: "" });
  });

  it("settles a row left behind once the reader returns after its last ask", async () => {
    const send = await unansweredSend(() => ({}));
    send.showSession(elsewhere);
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[2] ?? 0);
    send.showSession(oldSession);
    await send.controller.verifyUnansweredSends();

    expect(send.rows()).toEqual(["failed"]);
  });

  it("takes an answer that would not parse as an answer, not as a dead link", async () => {
    let asks = 0;
    const send = await unansweredSend(() => ({}), { operationOutcomes: () => { asks += 1; return Promise.reject(new SyntaxError("Unexpected token < in JSON")); } });
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[2] ?? 0);
    await vi.advanceTimersByTimeAsync(VERIFY_RETRY_MS * 3);

    expect({ reconnecting: send.claim() !== undefined, asks }).toEqual({ reconnecting: false, asks: VERIFY_AFTER_MS.length });
  });

  it("asks nothing more once the controller is disposed", async () => {
    const send = await unansweredSend(() => undefined);
    send.controller.dispose();
    await vi.advanceTimersByTimeAsync((VERIFY_AFTER_MS[2] ?? 0) + VERIFY_RETRY_MS * 3);

    expect(send.asked).toHaveLength(0);
  });

  it("writes the ledger's verdict onto the record, so the tray reads what the bubble reads", async () => {
    const refused = await unansweredSend(each("failed"));
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[0] ?? 0);
    const refusedRecords = refused.records();
    localStorage.clear();
    vi.useRealTimers();
    const lost = await unansweredSend(each("unknown"));
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[0] ?? 0);

    expect({ refused: refusedRecords, lost: lost.records() }).toEqual({ refused: [["failed", "not-sent", true]], lost: [["failed", "not-received", false]] });
  });
});

describe("phase 5 gate 2: verdicts on a message the daemon had taken", () => {
  it("brings a received message the daemon lost back to the outbox as not received, so Retry has its words", async () => {
    const send = await unansweredSend((ids, ask) => Object.fromEntries(ids.map((id) => [id, ask === 1 ? "pending" : "unknown"])));
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[0] ?? 0);
    const reserved = { rows: send.rows(), outbox: send.outbox() };
    await vi.advanceTimersByTimeAsync((VERIFY_AFTER_MS[1] ?? 0) - (VERIFY_AFTER_MS[0] ?? 0));

    expect({ reserved, rows: send.rows(), records: send.records() })
      .toEqual({ reserved: { rows: ["received"], outbox: [] }, rows: ["failed"], records: [["failed", "not-received", false]] });
  });

  it("keeps the row's claim for the session on screen when another session's ask runs", async () => {
    const send = await unansweredSend(() => undefined);
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[0] ?? 0);
    const ask: unknown = Reflect.get(send.controller, "askLedgerAbout");
    if (typeof ask !== "function") throw new Error("askLedgerAbout is not reachable");
    await Reflect.apply(ask, send.controller, [{ ...oldSession, id: "another-session" }, "local"]);

    expect({ row: send.row(), notice: send.notice() }).toEqual({ row: "link-down", notice: "" });
  });

  it("retires a reserved message once the transcript as stored shows it taken, whatever the patch carried", async () => {
    const send = await unansweredSend(each("pending"));
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[0] ?? 0);
    const write: unknown = Reflect.get(send.controller, "setState");
    if (typeof write !== "function") throw new Error("setState is not reachable");
    send.normalizeNextWrite((line) => (line.meta?.delivery === undefined ? line : { ...line, meta: { ...line.meta, delivery: { ...line.meta.delivery, state: "delivered" as const } } }));
    const reserve = () => localStorage.getItem(`pi-web:accepted-prompt:${outboxKey}`) ?? "";
    const before = reserve().includes(send.id);
    Reflect.apply(write, send.controller, [{ messages: send.messages() }]);

    expect({ before, after: reserve().includes(send.id) }).toEqual({ before: true, after: false });
  });
});

describe("phase 5 gate 5: an ask that answers after the reader moved on", () => {
  it("does not raise the row's claim for the session the reader switched to", async () => {
    let fail: (error: unknown) => void = () => undefined;
    const send = await unansweredSend(() => ({}), { operationOutcomes: () => new Promise((_resolve, reject) => { fail = reject; }) });
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[0] ?? 0);
    send.showSession({ ...oldSession, id: "another-session", path: "/tmp/another-session.jsonl" });
    fail(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(0);

    expect({ claim: send.claim(), notice: send.notice() }).toEqual({ claim: undefined, notice: "" });
  });
});

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

  it("waits for a refresh in flight before asking: the reopen is what re-records a restored inbox", async () => {
    let answerPage: (page: { messages: never[]; start: number; total: number }) => void = () => undefined;
    const send = await unansweredSend(each("pending"), {
      messages: () => new Promise((resolve) => { answerPage = resolve; }),
      status: (session) => Promise.resolve(status(typeof session === "string" ? session : session.id)),
      streamSnapshot: () => Promise.resolve({ seq: 1, epoch: "e.1", partial: null }),
    });
    const refreshing = send.controller.refreshSelectedSession();

    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[0] ?? 0);
    const whileRefreshing = send.asked.length;
    answerPage({ messages: [], start: 0, total: 0 });
    await refreshing;
    await vi.advanceTimersByTimeAsync(0);

    expect({ whileRefreshing, after: send.asked.length }).toEqual({ whileRefreshing: 0, after: 1 });
  });

  it("asks at once when the tab comes back", async () => {
    const send = await unansweredSend(each("succeeded"));
    await send.controller.verifyUnansweredSends();
    expect({ asked: send.asked.length, rows: send.rows() }).toEqual({ asked: 1, rows: ["received"] });
  });

  it("does not apply an answer to a row a retry moved on while the ledger was being asked", async () => {
    let answerAsk: (answer: Record<string, string>) => void = () => undefined;
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
      status: status(oldSession.id),
      sessionStatuses: { [oldSession.id]: status(oldSession.id) },
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, {
      api: { ...defaultApi, operationOutcomes: () => new Promise((resolve) => { answerAsk = resolve; }) },
      socket: new FakeSocket(),
    });
    state.messages = [{ role: "user", parts: [{ type: "text", text: "retried" }], meta: { delivery: { clientMessageId: "cm-retried", state: "unverifiable" } } }];

    const asking = controller.verifyUnansweredSends();
    state.messages = [{ role: "user", parts: [{ type: "text", text: "retried" }], meta: { delivery: { clientMessageId: "cm-retried", state: "sending" } } }];
    answerAsk({ "cm-retried": "failed" });
    await asking;

    expect(state.messages.map((line) => line.meta?.delivery?.state)).toEqual(["sending"]);
  });

  it("learns of a refusal a queued row missed while the reader was elsewhere, and leaves a still-pending one alone", async () => {
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
      status: status(oldSession.id),
      sessionStatuses: { [oldSession.id]: status(oldSession.id) },
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, {
      api: { ...defaultApi, operationOutcomes: () => Promise.resolve({ "cm-refused": "failed", "cm-waiting": "pending" }) },
      socket: new FakeSocket(),
    });
    state.messages = [
      { role: "user", parts: [{ type: "text", text: "refused while away" }], meta: { delivery: { clientMessageId: "cm-refused", state: "queued" } } },
      { role: "user", parts: [{ type: "text", text: "still waiting" }], meta: { delivery: { clientMessageId: "cm-waiting", state: "queued" } } },
    ];

    await controller.verifyUnansweredSends();

    expect(state.messages.map((line) => line.meta?.delivery?.state)).toEqual(["failed", "queued"]);
  });

  it("leaves the row open and honest when asking fails too, and keeps asking", async () => {
    const send = await unansweredSend(() => undefined);
    await vi.advanceTimersByTimeAsync(VERIFY_AFTER_MS[2] ?? 0);
    expect({ asked: send.asked.length, rows: send.rows() }).toEqual({ asked: 5, rows: ["unverifiable"] });
  });
});
