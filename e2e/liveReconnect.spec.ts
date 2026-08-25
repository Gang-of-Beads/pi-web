import { expect, test, type Page } from "@playwright/test";
import {
  archive,
  countContaining,
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
 * What the browser does when its event socket dies under it.
 *
 * "The page only updates if I refresh it" is the failure this covers: the
 * session controller has no polling timer, so the socket is the only path from
 * the daemon to the transcript, and everything that happened while it was down
 * has to arrive on reconnect without the user doing anything.
 *
 * The socket is killed in the page rather than at the proxy: closing it while
 * it is still connecting aborts the handshake without firing `open`, which is
 * the same thing a dropped connection looks like to the app, and it can be held
 * down for as long as the test needs.
 */

test.describe("live updates", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async () => { await ensureMockLlm(); });

  test("catches up without a manual refresh once the event socket comes back", async ({ page }) => {
    const missed = "sent while the socket was dead FASTMOCK";
    const workspace = await deliveryWorkspace(page.request);
    const session = await createSession(page.request, workspace.path);
    try {
      await setMockModel(page.request, session, workspace.path);
      await seedListedSession(page.request, session, workspace.path);
      await installSocketControl(page);
      await openSession(page, session, workspace);

      await startSlowTurn(page.request, session, workspace.path);
      // The composer only learns the agent is busy through the socket, so this
      // is also the proof that the live channel worked before it was cut.
      await waitForBusyComposer(page);

      await setSocketsBlocked(page, true);
      await expect.poll(async () => (await socketState(page)).live, { timeout: 20_000, message: "every session socket must be down" }).toBe(0);
      const beforeReconnect = await socketState(page);

      const sent = await page.request.post(promptPath(session), { data: { cwd: workspace.path, text: missed, clientMessageId: "e2e-reconnect-1" } });
      expect(sent.ok(), "queue a message the browser cannot hear about").toBe(true);
      await waitForQueued(page.request, session, workspace.path);

      // Nothing reaches the page while the channel is down - there is no poll
      // to fall back on, which is exactly why the reconnect has to reconcile.
      await page.waitForTimeout(3000);
      expect(countContaining(await queuedTranscriptTexts(page), missed), "a dead socket cannot deliver news").toBe(0);

      await setSocketsBlocked(page, false);

      // No reload, no navigation: the reconnect and the refresh it triggers are
      // the only things that can put this on the screen.
      await expect.poll(async () => countContaining(await queuedTranscriptTexts(page), missed), { timeout: 60_000, message: "the queue missed while offline must arrive on its own" })
        .toBe(1);
      expect((await socketState(page)).opened, "the app must have opened a fresh socket").toBeGreaterThan(beforeReconnect.opened);
    } finally {
      await archive(page.request, session, workspace.path);
    }
  });
});

interface SocketState { opened: number; live: number }

/**
 * Replace `WebSocket` with one that can be held down, before any app code runs.
 *
 * Only the API's own sockets are tracked: the dev server's hot-reload socket
 * shares the origin and killing it would break the page for reasons that have
 * nothing to do with session events.
 */
async function installSocketControl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { opened: 0, blocked: false, sockets: [] as WebSocket[] };
    (globalThis as unknown as Record<string, unknown>)["piSocketControl"] = state;
    const NativeWebSocket = globalThis.WebSocket;
    class TrackedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (!String(url).includes("/api/machines/")) return;
        state.opened += 1;
        state.sockets.push(this);
        // Closing during CONNECTING aborts the handshake: `open` never fires,
        // so the app's reconnect path runs instead of its ready path.
        if (state.blocked) this.close();
      }
    }
    globalThis.WebSocket = TrackedWebSocket as unknown as typeof WebSocket;
  });
}

async function setSocketsBlocked(page: Page, blocked: boolean): Promise<void> {
  await page.evaluate((value) => {
    const state = (globalThis as unknown as Record<string, unknown>)["piSocketControl"] as { blocked: boolean; sockets: WebSocket[] };
    state.blocked = value;
    if (value) for (const socket of state.sockets) socket.close();
  }, blocked);
}

async function socketState(page: Page): Promise<SocketState> {
  return await page.evaluate(() => {
    const state = (globalThis as unknown as Record<string, unknown>)["piSocketControl"] as { opened: number; sockets: WebSocket[] };
    return { opened: state.opened, live: state.sockets.filter((socket) => socket.readyState === WebSocket.OPEN).length };
  });
}
