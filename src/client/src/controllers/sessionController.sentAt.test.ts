import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { carryDeliveryForward } from "../messageDelivery";
import { normalizeMessage } from "../chatMessages";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, status, workspace, type AppState } from "./sessionController.testSupport";

/**
 * One timestamp that never moves (B5, state-diagram D1). The row shows the time its sender sent
 * it, and the message carries that time to the daemon, which stamps it on pi's committed copy;
 * pi's own stamp is the moment the daemon handed the message over (12:23:49, :50 and :51 all
 * became 12:24:04 in audit 5d672be6 P2-3).
 */
function controllerSending(): { controller: SessionController; read: () => AppState; sent: () => (string | undefined)[] } {
  let state: AppState = {
    ...initialAppState(),
    selectedWorkspace: workspace,
    selectedSession: oldSession,
    sessions: [oldSession],
    status: status(oldSession.id),
    sessionStatuses: { [oldSession.id]: status(oldSession.id) },
  };
  const sentTimes: (string | undefined)[] = [];
  const api: typeof defaultApi = {
    ...defaultApi,
    prompt: (_session, _text, _behavior, _machineId, _attachments, _clientMessageId, sentAt) => {
      sentTimes.push(sentAt);
      return Promise.resolve({ accepted: true });
    },
  };
  const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new FakeSocket() });
  return { controller, read: () => state, sent: () => sentTimes };
}

describe("a message keeps the time its sender sent it (B5)", () => {
  it("sends the time its bubble shows", async () => {
    const { controller, read, sent } = controllerSending();

    await controller.send("hello there");

    const shown = read().messages.find((line) => line.role === "user")?.meta?.timestamp;
    expect({ sent: sent(), shownIsATime: typeof shown === "string" }).toEqual({ sent: [shown], shownIsATime: true });
  });

  it("sends an outbox record's own time on a retry whose bubble is gone", async () => {
    const { controller, read, sent } = controllerSending();
    const recorded = "2026-10-02T08:55:49.698Z";

    await controller.send("written before a reload", undefined, undefined, "inline", { clientMessageId: "c-outbox", sentAt: recorded });

    expect({ sent: sent(), shown: read().messages.find((line) => line.role === "user")?.meta?.timestamp }).toEqual({ sent: [recorded], shown: recorded });
  });

  it("keeps the time a revived bubble already shows on a retry", async () => {
    const { controller, read, sent } = controllerSending();
    await controller.send("first try", undefined, undefined, "inline", { clientMessageId: "c-retry", sentAt: "2026-10-02T08:55:49.698Z" });

    await controller.send("first try", undefined, undefined, "inline", { clientMessageId: "c-retry", sentAt: "2026-10-02T09:10:00.000Z" });

    expect({ sent: sent(), shown: read().messages.filter((line) => line.role === "user").map((line) => line.meta?.timestamp) })
      .toEqual({ sent: ["2026-10-02T08:55:49.698Z", "2026-10-02T08:55:49.698Z"], shown: ["2026-10-02T08:55:49.698Z"] });
  });

  it("does not move the row when the committed copy, stamped with that time, replaces the bubble", async () => {
    const { controller, read } = controllerSending();
    await controller.send("hello there", undefined, undefined, "inline", { clientMessageId: "c-commit", sentAt: "2026-10-02T12:23:49.000Z" });
    const bubble = read().messages.find((line) => line.role === "user");
    if (bubble === undefined) throw new Error("no bubble");

    const [committed] = normalizeMessage({ role: "user", content: [{ type: "text", text: "hello there" }], timestamp: Date.parse("2026-10-02T12:23:49.000Z"), clientMessageId: "c-commit" });
    if (committed === undefined) throw new Error("the committed copy normalised to nothing");

    expect(carryDeliveryForward(bubble, committed).meta?.timestamp).toBe(bubble.meta?.timestamp);
  });
});
