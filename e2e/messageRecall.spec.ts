import { expect, test } from "@playwright/test";
import {
  archive,
  clickRecall,
  clickSend,
  clickStop,
  composerText,
  countContaining,
  createSession,
  deliveryWorkspace,
  ensureMockLlm,
  openSession,
  promptPath,
  queuedTranscriptTexts,
  readUserMessages,
  recallButtons,
  seedListedSession,
  sendFromComposer,
  setMockModel,
  startSlowTurn,
  status,
  typeInComposer,
  userBubbleTexts,
  waitForBusyComposer,
  waitForQueued,
} from "./deliveryDriver";

/**
 * Taking a message back: nothing typed may vanish, and nothing recalled may be
 * read anyway.
 *
 * `recalled` and `dropped` are the same transition with different triggers
 * (docs/message-delivery-design.md): the Recall button and the stop button both
 * owe the sender their text back. The server implements recall as
 * clear-and-replay of the whole queue, so the risks worth an end-to-end test
 * are the ones a unit test cannot see - a message read twice (once as the
 * original, once as the edit), a queue that comes back reordered, and a stop
 * button that deletes what someone already typed.
 *
 * Every test opens the app *before* starting the turn it queues behind: a mock
 * turn lasts about 18s and the first navigation costs roughly the same, so the
 * other order races the window it depends on.
 */

test.describe("recall", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async () => { await ensureMockLlm(); });

  test("hands a queued message back for editing, and the agent reads only the edit", async ({ page }) => {
    const draft = "recall me: ask about the wrong file";
    const edit = " - the right one, please FASTMOCK";
    const workspace = await deliveryWorkspace(page.request);
    const session = await createSession(page.request, workspace.path);
    try {
      await setMockModel(page.request, session, workspace.path);
      await seedListedSession(page.request, session, workspace.path);
      await openSession(page, session, workspace);
      await startSlowTurn(page.request, session, workspace.path);
      await waitForBusyComposer(page);

      await sendFromComposer(page, draft);
      // Polled, not sampled: the bubble is optimistic and appears a round trip
      // before the server acknowledges the queue, so the action trails it.
      await expect.poll(async () => await recallButtons(page), { timeout: 20_000, message: "a queued message must offer a recall action" })
        .toBeGreaterThan(0);

      await clickRecall(page, draft);

      // The text comes back where it can be edited...
      await expect.poll(async () => await composerText(page), { timeout: 20_000, message: "a recalled message must return to the composer" })
        .toContain(draft);
      // ...and stops being part of the conversation, because a message that is
      // in the composer is not one the agent is about to read. Leaving the
      // bubble behind would read as delivered the moment the queue drops it.
      await expect.poll(async () => countContaining(await userBubbleTexts(page), draft), { timeout: 20_000, message: "a recalled message must leave the transcript" })
        .toBe(0);

      await typeInComposer(page, edit);
      await clickSend(page);

      // The turn ends, takes whatever the queue holds, and goes idle. What it
      // read is then on disk, and that is the only place that can prove the
      // original did not go along with the edit.
      await expect.poll(async () => {
        const current = await status(page.request, session, workspace.path);
        return current.isStreaming !== true && (current.queuedMessages?.length ?? 0) === 0;
      }, { timeout: 120_000, message: "the session must finish what it was given" }).toBe(true);

      const read = (await readUserMessages(page.request, session, workspace.path)).filter((text) => text.includes("recall me"));
      expect(read, "the recalled original must never reach the agent").toEqual([`${draft}${edit}`]);
    } finally {
      await archive(page.request, session, workspace.path);
    }
  });

  test("recalling the middle of a queue leaves the rest in order", async ({ page }) => {
    // Sent from elsewhere (another device, an injected command), so they carry
    // no bubble in this browser and are recalled from the queued-message panel.
    // The server empties the whole queue and replays the survivors to remove
    // one entry, which is precisely what can reorder them.
    const queued = ["ordered message one FASTMOCK", "ordered message two FASTMOCK", "ordered message three FASTMOCK"];
    const workspace = await deliveryWorkspace(page.request);
    const session = await createSession(page.request, workspace.path);
    try {
      await setMockModel(page.request, session, workspace.path);
      await seedListedSession(page.request, session, workspace.path);
      await openSession(page, session, workspace);
      await startSlowTurn(page.request, session, workspace.path);
      await waitForBusyComposer(page);

      for (const [index, text] of queued.entries()) {
        const sent = await page.request.post(promptPath(session), { data: { cwd: workspace.path, text, clientMessageId: `e2e-order-${String(index + 1)}` } });
        expect(sent.ok(), `queue message ${String(index + 1)}`).toBe(true);
      }
      await waitForQueued(page.request, session, workspace.path, 3);
      await expect.poll(async () => (await queuedTranscriptTexts(page)).length, { timeout: 20_000, message: "all three must be listed before one is taken back" })
        .toBe(3);

      await clickRecall(page, queued[1]!);

      // The server's own projection is the authority on order; the panel is
      // asserted separately because a correct queue rendered in the wrong order
      // is still a message the user thinks the agent will read next.
      await expect.poll(async () => (await status(page.request, session, workspace.path)).queuedMessages?.map((message) => message.text), { timeout: 20_000, message: "the survivors keep their order" })
        .toEqual([queued[0], queued[2]]);
      await expect.poll(async () => (await queuedTranscriptTexts(page)).map((row) => row.includes(queued[0]!) ? "one" : row.includes(queued[1]!) ? "two" : row.includes(queued[2]!) ? "three" : "?"), { timeout: 20_000, message: "the panel shows the survivors in order" })
        .toEqual(["one", "three"]);
      await expect.poll(async () => await composerText(page), { timeout: 20_000, message: "the recalled text must come back" })
        .toContain(queued[1]!);

      await expect.poll(async () => {
        const current = await status(page.request, session, workspace.path);
        return current.isStreaming !== true && (current.queuedMessages?.length ?? 0) === 0;
      }, { timeout: 120_000, message: "the session must drain what is left" }).toBe(true);

      const read = (await readUserMessages(page.request, session, workspace.path)).filter((text) => text.startsWith("ordered message"));
      expect(read, "first-then-third, and never the recalled one").toEqual([queued[0], queued[2]]);
    } finally {
      await archive(page.request, session, workspace.path);
    }
  });

  test("stop returns the queued messages to the composer instead of deleting them", async ({ page }) => {
    // Abort empties both lanes because those messages were written for the turn
    // being cancelled. It used to destroy them: pressing stop silently deleted
    // work someone had already typed, which is the gap this closes.
    const first = "stop me: the first thing I queued";
    const second = "stop me: and the second thing";
    const workspace = await deliveryWorkspace(page.request);
    const session = await createSession(page.request, workspace.path);
    try {
      await setMockModel(page.request, session, workspace.path);
      await seedListedSession(page.request, session, workspace.path);
      await openSession(page, session, workspace);
      await startSlowTurn(page.request, session, workspace.path);
      await waitForBusyComposer(page);

      await sendFromComposer(page, first);
      await sendFromComposer(page, second);
      await waitForQueued(page.request, session, workspace.path, 2);

      await clickStop(page);

      const composer = await pollComposerContaining(page, second);
      expect(composer, "both messages must come back").toContain(first);
      // Order is kept as well as content: they are handed back as one draft in
      // the order they were queued, so re-sending says the same thing again.
      expect(composer.indexOf(first)).toBeLessThan(composer.indexOf(second));

      // ...and they are only in one place. A bubble left in the transcript
      // while the text sits in the composer is the duplicate this design is
      // trying to avoid.
      await expect.poll(async () => countContaining(await userBubbleTexts(page), "stop me:"), { timeout: 20_000, message: "the discarded bubbles go with the text" })
        .toBe(0);
      const stopped = await status(page.request, session, workspace.path);
      expect(stopped.queuedMessages ?? []).toEqual([]);
    } finally {
      await archive(page.request, session, workspace.path);
    }
  });
});

async function pollComposerContaining(page: import("@playwright/test").Page, needle: string): Promise<string> {
  await expect.poll(async () => await composerText(page), { timeout: 20_000, message: "stop must put the queued text back in the composer" })
    .toContain(needle);
  return await composerText(page);
}
