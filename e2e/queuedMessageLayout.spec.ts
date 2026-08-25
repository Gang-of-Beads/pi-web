import { expect, test, type Page } from "@playwright/test";
import {
  archive,
  createSession,
  deliveryWorkspace,
  ensureMockLlm,
  openSession,
  promptPath,
  queuedTranscriptTexts,
  seedListedSession,
  setMockModel,
  startSlowTurn,
  waitForBusyComposer,
  waitForQueued,
} from "./deliveryDriver";

/**
 * Where queued messages are allowed to be on a phone.
 *
 * 1.202608.6 moved them into a panel pinned above the composer. It was correct
 * about the data and wrong about the screen: on a phone the panel covered the
 * conversation it was annotating, so the messages the queue described could not
 * be read while they were waiting. The panel is gone since 1.202608.28: each
 * queued message is drawn in the transcript, marked gold, in queue order, so
 * these assertions pin the geometry of those rows down - measured geometry
 * rather than the presence of a class, because the regression was a
 * correctly-rendered panel in the wrong place.
 */

test.describe("queued messages on a phone", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(({ isMobile }) => isMobile === false, "phone-viewport behaviour");

  test.beforeAll(async () => { await ensureMockLlm(); });

  test("keeps the conversation visible and scrollable while messages are queued", async ({ page }) => {
    // Long enough to overflow a phone screen: a queue that fits alongside the
    // transcript proves nothing about a queue that does not.
    const queued = [
      `queued while busy: the first one\n${"filler line\n".repeat(8)}`,
      `queued while busy: the second one\n${"filler line\n".repeat(8)}`,
    ];
    const workspace = await deliveryWorkspace(page.request);
    const session = await createSession(page.request, workspace.path);
    try {
      await setMockModel(page.request, session, workspace.path);
      await seedListedSession(page.request, session, workspace.path);
      await openSession(page, session, workspace);
      await startSlowTurn(page.request, session, workspace.path);
      await waitForBusyComposer(page);

      // Sent from elsewhere, so they have no bubble of their own: each one is
      // given a transcript row in the order the queue will send it.
      for (const text of queued) {
        const sent = await page.request.post(promptPath(session), { data: { cwd: workspace.path, text } });
        expect(sent.ok(), "queue a message from another client").toBe(true);
      }
      await waitForQueued(page.request, session, workspace.path, 2);
      await expect.poll(async () => (await queuedTranscriptTexts(page)).length, { timeout: 20_000, message: "the queued rows must be showing before they are measured" })
        .toBe(2);

      await waitForChatAtBottom(page);
      const layout = await chatLayout(page);
      // The queued rows live inside the scroller, not stacked between the
      // transcript and the composer: that containment is what makes the rest
      // of the assertions about scrolling meaningful.
      expect(layout.queuedRowInsideScroller).toBe(true);
      // The transcript keeps the majority of a phone screen while the queue is
      // full. When the panel was pinned it took the chat down with it.
      expect(layout.chatHeight / layout.viewport).toBeGreaterThan(0.5);
      // Nothing overlaps the composer, and the composer does not overlap the
      // transcript: they are neighbours, not layers.
      expect(layout.composerTop).toBeGreaterThanOrEqual(layout.chatBottom - 1);
      // ...and the conversation is longer than the window, which is the case
      // that made the occlusion visible in the first place.
      expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight);

      // A pinned panel does not move when the transcript scrolls. These rows
      // have to, because they are part of the conversation.
      const scrolled = await scrollChatToTop(page);
      expect(scrolled.scrollTop).toBe(0);
      expect(scrolled.queuedRowTop, "the queued rows scroll with the transcript").toBeGreaterThan(layout.queuedRowTop);

      // And the top of the conversation is reachable: the first message is
      // inside the visible chat area once scrolled to it, rather than behind
      // whatever the queue is rendering.
      const first = await firstBubbleGeometry(page);
      expect(first, "the transcript must still have its first message").not.toBeNull();
      expect(first!.top).toBeGreaterThanOrEqual(scrolled.chatTop - 1);
      expect(first!.top).toBeLessThan(scrolled.chatBottom);
    } finally {
      await archive(page.request, session, workspace.path);
    }
  });
});

interface ChatLayout {
  viewport: number;
  chatTop: number;
  chatBottom: number;
  chatHeight: number;
  composerTop: number;
  scrollHeight: number;
  clientHeight: number;
  queuedRowInsideScroller: boolean;
  queuedRowTop: number;
}

async function chatLayout(page: Page): Promise<ChatLayout> {
  return await page.evaluate(() => {
    const app = document.querySelector("pi-web-app")?.shadowRoot;
    const chat = app?.querySelector("chat-view")?.shadowRoot;
    const scroller = chat?.querySelector(".chat");
    const composer = app?.querySelector("prompt-editor");
    // A queued message drawn from the server's queue carries the queued mark;
    // this browser's own bubble would too, so either way the row is the one
    // the user reads "while waiting".
    const queuedRow = [...(scroller?.querySelectorAll("article.msg") ?? [])]
      .find((row) => row.querySelector(".delivery-text")?.textContent?.startsWith("Queued"));
    const scrollerBox = scroller?.getBoundingClientRect();
    const rowBox = queuedRow?.getBoundingClientRect();
    return {
      viewport: window.innerHeight,
      chatTop: Math.round(scrollerBox?.top ?? 0),
      chatBottom: Math.round(scrollerBox?.bottom ?? 0),
      chatHeight: Math.round(scrollerBox?.height ?? 0),
      composerTop: Math.round(composer?.getBoundingClientRect().top ?? 0),
      scrollHeight: Math.round(scroller?.scrollHeight ?? 0),
      clientHeight: Math.round(scroller?.clientHeight ?? 0),
      queuedRowInsideScroller: scroller !== null && scroller !== undefined && queuedRow !== null && queuedRow !== undefined && scroller.contains(queuedRow),
      queuedRowTop: Math.round(rowBox?.top ?? 0),
    };
  });
}

/**
 * Wait for the transcript to settle at the bottom, where the queue lives.
 *
 * The queued rows are part of the conversation, so before the view has
 * finished auto-scrolling they sit below the fold and their bounding boxes are
 * naturally past the composer - which is what the occlusion assertion
 * measures. Measuring without waiting therefore failed intermittently and
 * instantly (panel bottom 1443 against a composer top of 686) on a machine
 * busy enough to delay the scroll by a frame. Seen 2026-08-22, once in two
 * full suite runs.
 *
 * Asserting the scroll rather than forcing it: if the view stops following its
 * own conversation, that is a real defect and this should say so.
 */
async function waitForChatAtBottom(page: Page): Promise<void> {
  await expect.poll(async () => await page.evaluate(() => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    const scroller = chat?.querySelector(".chat");
    if (scroller === null || scroller === undefined) return -1;
    // Distance from the bottom, rounded: sub-pixel layout and smooth scrolling
    // both leave a fraction that never reaches exactly zero.
    return Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight);
  }), { timeout: 10_000, message: "the transcript must settle at the bottom, where the queue is rendered" })
    .toBeLessThanOrEqual(2);
}

async function scrollChatToTop(page: Page): Promise<{ scrollTop: number; queuedRowTop: number; chatTop: number; chatBottom: number }> {
  const measured = await page.evaluate(async () => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    const scroller = chat?.querySelector(".chat");
    if (scroller === null || scroller === undefined) return { scrollTop: -1, queuedRowTop: -1, chatTop: -1, chatBottom: -1 };
    scroller.scrollTop = 0;
    await new Promise((resolve) => requestAnimationFrame(() => { resolve(undefined); }));
    const box = scroller.getBoundingClientRect();
    const queuedRow = [...(scroller.querySelectorAll("article.msg") ?? [])]
      .find((row) => row.querySelector(".delivery-text")?.textContent?.startsWith("Queued"));
    return {
      scrollTop: Math.round(scroller.scrollTop),
      queuedRowTop: Math.round(queuedRow?.getBoundingClientRect().top ?? -1),
      chatTop: Math.round(box.top),
      chatBottom: Math.round(box.bottom),
    };
  });
  return measured;
}

async function firstBubbleGeometry(page: Page): Promise<{ top: number; bottom: number } | null> {
  return await page.evaluate(() => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    const box = chat?.querySelector("article.msg")?.getBoundingClientRect();
    return box === undefined ? null : { top: Math.round(box.top), bottom: Math.round(box.bottom) };
  });
}