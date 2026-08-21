import { expect, test, type Page } from "@playwright/test";
import { apiBaseURL } from "../playwright.config";
import {
  archive,
  countContaining,
  createSession,
  CWD,
  deliveryMarks,
  deliveryWorkspace,
  ensureMockLlm,
  openSession,
  promptPath,
  queuedRowTexts,
  recallButtons,
  seedListedSession,
  sendFromComposer,
  setMockModel,
  startSlowTurn,
  userBubbleTexts,
  waitForBusyComposer,
  waitForListed,
  waitForQueued,
  waitForStreaming,
} from "./deliveryDriver";

/**
 * What the sender is told about a message, end to end.
 *
 * The reported failure was a message that appeared twice at once - as a
 * transcript bubble and as a "Queued messages / 1 pending" row - with nothing
 * saying whether the server had it. Both halves of that are asserted here
 * against the real daemon: the correlation id must survive the round trip into
 * the queue projection, and the browser must render exactly one bubble carrying
 * a delivery mark.
 *
 * The turn is made deliberately slow by pointing the session at the mock
 * provider (`e2e/mockLlm.mjs`, 60 chunks x 300ms), because the states worth
 * asserting only exist while the agent is busy.
 */

const QUEUED_FROM_BROWSER = "queued from the browser";

test.beforeAll(async () => { await ensureMockLlm(); });

test.describe("delivery correlation (API)", () => {
  test.use({ baseURL: apiBaseURL });

  test("keeps the sender's id on the queued message", async ({ request }) => {
    const session = await createSession(request);
    try {
      await setMockModel(request, session);
      // First prompt starts a long turn; the second has to queue behind it.
      await startSlowTurn(request, session);

      const clientMessageId = "e2e-delivery-1";
      const queuedSend = await request.post(promptPath(session), { data: { cwd: CWD, text: "queued behind the turn", clientMessageId } });
      expect(queuedSend.ok()).toBe(true);

      const queued = await waitForQueued(request, session);
      const entry = queued.queuedMessages?.find((message) => message.text === "queued behind the turn");
      expect(entry, "the queued message must be visible in status").toBeDefined();
      expect(entry?.clientMessageId).toBe(clientMessageId);
    } finally {
      await archive(request, session);
    }
  });

  test("queues a deliberate repeat but not a retry of the same request", async ({ request }) => {
    const session = await createSession(request);
    try {
      await setMockModel(request, session);
      await request.post(promptPath(session), { data: { cwd: CWD, text: "first, take your time" } });
      await waitForStreaming(request, session);

      // Same id twice is a retry (the outbox resending after a dropped reply).
      await request.post(promptPath(session), { data: { cwd: CWD, text: "continue", clientMessageId: "retry-1" } });
      await request.post(promptPath(session), { data: { cwd: CWD, text: "continue", clientMessageId: "retry-1" } });
      // A different id with the same text is a person saying it again.
      await request.post(promptPath(session), { data: { cwd: CWD, text: "continue", clientMessageId: "repeat-2" } });

      const queued = await waitForQueued(request, session);
      const continues = queued.queuedMessages?.filter((message) => message.text === "continue") ?? [];
      expect(continues).toHaveLength(2);
      expect(continues.map((message) => message.clientMessageId)).toEqual(["retry-1", "repeat-2"]);
    } finally {
      await archive(request, session);
    }
  });

  test("ignores an oversized or empty correlation id instead of storing it", async ({ request }) => {
    const session = await createSession(request);
    try {
      await setMockModel(request, session);
      await request.post(promptPath(session), { data: { cwd: CWD, text: "first, take your time" } });
      await waitForStreaming(request, session);
      const rejected = await request.post(promptPath(session), { data: { cwd: CWD, text: "unlabelled", clientMessageId: "x".repeat(500) } });
      expect(rejected.ok()).toBe(true);

      const queued = await waitForQueued(request, session);
      expect(queued.queuedMessages?.find((message) => message.text === "unlabelled")?.clientMessageId).toBeUndefined();
    } finally {
      await archive(request, session);
    }
  });
});

test.describe("delivery marks (UI)", () => {
  // The mock turn is deliberately long (that is what makes a message queue), so
  // this walks past the default per-test budget.
  test.describe.configure({ timeout: 120_000 });

  test("marks a queued message in place, offers to recall it, and reaches Read", async ({ page }) => {
    // The route addresses a session by project and workspace id, so the session
    // has to live in a registered project rather than an arbitrary cwd.
    const workspace = await deliveryWorkspace(page.request);
    const session = await createSession(page.request, workspace.path);
    try {
      await setMockModel(page.request, session, workspace.path);
      // The busy window opens after the app is up, not before: a mock turn is
      // about as long as the first navigation takes, so a turn started ahead of
      // it was regularly over before the first keystroke and this message went
      // straight through instead of queueing.
      await seedListedSession(page.request, session, workspace.path);
      await openSession(page, session, workspace);
      await startSlowTurn(page.request, session, workspace.path);
      await waitForBusyComposer(page);
      await sendFromComposer(page, QUEUED_FROM_BROWSER);

      // One representation: a bubble in place, marked, never a second copy in
      // the queue panel. Moving it out of the transcript was tried twice and
      // failed twice - hidden on stale state in 1.202608.5, and in 1.202608.6
      // pinned above the composer where it covered the conversation on a phone.
      await expect.poll(async () => await chatState(page), { timeout: 20_000, message: "one marked bubble and no duplicate queue row" })
        .toMatchObject({ bubbles: 1, queuedRows: 0 });

      const marks = await deliveryMarks(page, QUEUED_FROM_BROWSER);
      expect(marks.length).toBe(1);
      expect(["Sent", "Queued", "Queued to steer", "Read"]).toContain(marks[0]);

      // Recallable while the server still holds it: that affordance was the
      // point of the whole exercise and it now lives on the bubble. Polled, not
      // sampled: the bubble is optimistic and appears before the server has
      // acknowledged the queue, so the button trails it by a round trip.
      await expect.poll(async () => await recallButtons(page), { timeout: 20_000, message: "a queued message must offer a recall action" })
        .toBeGreaterThan(0);

      // The mark has to survive the moment the agent commits its own copy.
      await expect.poll(async () => (await deliveryMarks(page, QUEUED_FROM_BROWSER))[0], { timeout: 60_000, message: "the mark must reach Read once the turn takes the message" })
        .toBe("Read");
    } finally {
      await archive(page.request, session, workspace.path);
    }
  });

  test("says a message was not sent when the request never reaches the server", async ({ page }) => {
    const workspace = await deliveryWorkspace(page.request);
    const session = await createSession(page.request, workspace.path);
    try {
      await setMockModel(page.request, session, workspace.path);
      await startSlowTurn(page.request, session, workspace.path);
      await waitForListed(page.request, session, workspace.path);
      await openSession(page, session, workspace);

      // A dropped connection, which used to look exactly like a successful
      // send. Nothing here depends on the turn still running: the request is
      // aborted in the browser, so the message never reaches the queue at all.
      await page.route("**/prompt", async (route) => { await route.abort("connectionfailed"); });
      await sendFromComposer(page, QUEUED_FROM_BROWSER);

      await expect.poll(async () => (await deliveryMarks(page, QUEUED_FROM_BROWSER))[0], { timeout: 20_000, message: "a failed send must say so" }).toBe("Not sent");
      expect(await chatState(page)).toMatchObject({ bubbles: 1, queuedRows: 0 });
    } finally {
      await page.unroute("**/prompt");
      await archive(page.request, session, workspace.path);
    }
  });
});

/** How many places the browser is showing the same message in. */
async function chatState(page: Page): Promise<{ bubbles: number; queuedRows: number }> {
  return {
    bubbles: countContaining(await userBubbleTexts(page), QUEUED_FROM_BROWSER),
    queuedRows: countContaining(await queuedRowTexts(page), QUEUED_FROM_BROWSER),
  };
}
