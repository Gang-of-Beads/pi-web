import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiBaseURL } from "../playwright.config";
import { CONTAINER_HOME, createProject, firstWorkspace, type WorkspaceRef } from "./fixtures";

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

const CWD = "/workspace";
const MOCK_MODEL = { provider: "mock", modelId: "mock-model" };

test.describe("delivery correlation (API)", () => {
  test.use({ baseURL: apiBaseURL });

  test("keeps the sender's id on the queued message", async ({ request }) => {
    const session = await createSession(request);
    try {
      await setMockModel(request, session);
      // First prompt starts a long turn; the second has to queue behind it.
      const first = await request.post(promptPath(session), { data: { cwd: CWD, text: "first, take your time" } });
      expect(first.ok()).toBe(true);
      await waitForStreaming(request, session);

      const clientMessageId = "e2e-delivery-1";
      const queuedSend = await request.post(promptPath(session), { data: { cwd: CWD, text: "queued behind the turn", clientMessageId } });
      expect(queuedSend.ok()).toBe(true);

      const status = await waitForQueued(request, session);
      const entry = status.queuedMessages?.find((message) => message.text === "queued behind the turn");
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

      const status = await waitForQueued(request, session);
      const continues = status.queuedMessages?.filter((message) => message.text === "continue") ?? [];
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

      const status = await waitForQueued(request, session);
      expect(status.queuedMessages?.find((message) => message.text === "unlabelled")?.clientMessageId).toBeUndefined();
    } finally {
      await archive(request, session);
    }
  });
});

test.describe("delivery marks (UI)", () => {
  // The mock turn is deliberately long (that is what makes a message queue), so
  // this walks past the default per-test budget.
  test.describe.configure({ timeout: 120_000 });

  test("shows a queued message in the dock only, then in the transcript once taken", async ({ page }) => {
    // The route addresses a session by project and workspace id, so the session
    // has to live in a registered project rather than an arbitrary cwd.
    const workspace = await deliveryWorkspace(page.request);
    const session = await createSession(page.request, workspace.path);
    try {
      await setMockModel(page.request, session, workspace.path);
      await page.request.post(promptPath(session), { data: { cwd: workspace.path, text: "first, take your time" } });
      await waitForStreaming(page.request, session, workspace.path);
      // A session appears in the workspace listing only once it has a
      // transcript on disk, and the route can only restore a session the app
      // has listed - so wait for the daemon to publish it before navigating.
      await waitForListed(page.request, session, workspace.path);

      await openSession(page, session, workspace);
      await sendFromComposer(page, "queued from the browser");

      // Exactly one representation at a time. While the server holds the
      // message it belongs to the pinned dock, where it stays reachable and
      // recallable instead of scrolling away with the history.
      await expect.poll(async () => await chatState(page), { timeout: 20_000, message: "one queued row in the dock and no transcript bubble" })
        .toMatchObject({ bubbles: 0, queuedRows: 1 });

      // ...and it must be recallable while it is there, which is the whole
      // point of keeping it out of the transcript.
      expect(await recallButtons(page)).toBeGreaterThan(0);

      // The moment the agent takes it, it becomes ordinary history: the dock
      // empties and the message appears in the transcript. 1.202608.5 shipped a
      // version of this that hid the bubble on client-side state alone, so a
      // message the queue had already released stayed invisible until a reload.
      await expect.poll(async () => await chatState(page), { timeout: 60_000, message: "the message must reach the transcript once the turn takes it" })
        .toMatchObject({ bubbles: 1, queuedRows: 0 });
    } finally {
      await archive(page.request, session, workspace.path);
    }
  });

  test("says a message was not sent when the request never reaches the server", async ({ page }) => {
    const workspace = await deliveryWorkspace(page.request);
    const session = await createSession(page.request, workspace.path);
    try {
      await setMockModel(page.request, session, workspace.path);
      await page.request.post(promptPath(session), { data: { cwd: workspace.path, text: "first, take your time" } });
      await waitForStreaming(page.request, session, workspace.path);
      await waitForListed(page.request, session, workspace.path);
      await openSession(page, session, workspace);

      // A dropped connection, which used to look exactly like a successful send.
      await page.route("**/prompt", async (route) => { await route.abort("connectionfailed"); });
      await sendFromComposer(page, "queued from the browser");

      await expect.poll(async () => (await deliveryMarks(page))[0], { timeout: 20_000, message: "a failed send must say so" }).toBe("Not sent");
      expect(await chatState(page)).toMatchObject({ bubbles: 1, queuedRows: 0 });
    } finally {
      await page.unroute("**/prompt");
      await archive(page.request, session, workspace.path);
    }
  });
});

/** A stable project so repeated runs do not bury the container in fixtures. */
async function deliveryWorkspace(request: APIRequestContext): Promise<WorkspaceRef> {
  const name = "e2e-fixture-delivery";
  const projectId = await createProject(request, name, `${CONTAINER_HOME}/${name}`);
  return await firstWorkspace(request, projectId);
}

interface SessionRef { id: string }

interface StatusBody {
  isStreaming?: boolean;
  queuedMessages?: { kind: string; text: string; clientMessageId?: string }[];
}

type RequestContext = Page["request"];

function promptPath(session: SessionRef): string {
  return `${apiBaseURL}/api/machines/local/sessions/${session.id}/prompt`;
}

async function createSession(request: RequestContext, cwd = CWD): Promise<SessionRef> {
  const created = await request.post(`${apiBaseURL}/api/machines/local/sessions`, { data: { cwd } });
  expect(created.ok(), "create session").toBe(true);
  return await created.json() as SessionRef;
}

async function setMockModel(request: RequestContext, session: SessionRef, cwd = CWD): Promise<void> {
  const response = await request.post(`${apiBaseURL}/api/machines/local/sessions/${session.id}/model`, { data: { cwd, ...MOCK_MODEL } });
  expect(response.ok(), "point the session at the mock provider").toBe(true);
}

async function status(request: RequestContext, session: SessionRef, cwd = CWD): Promise<StatusBody> {
  const response = await request.get(`${apiBaseURL}/api/machines/local/sessions/${session.id}/status?cwd=${encodeURIComponent(cwd)}`);
  expect(response.ok()).toBe(true);
  return await response.json() as StatusBody;
}

async function waitForStreaming(request: RequestContext, session: SessionRef, cwd = CWD): Promise<void> {
  await expect.poll(async () => (await status(request, session, cwd)).isStreaming, { timeout: 20_000, message: "the first turn must be running" }).toBe(true);
}

async function waitForQueued(request: RequestContext, session: SessionRef, cwd = CWD): Promise<StatusBody> {
  await expect.poll(async () => (await status(request, session, cwd)).queuedMessages?.length ?? 0, { timeout: 20_000, message: "the second message must queue" })
    .toBeGreaterThan(0);
  return await status(request, session, cwd);
}

async function waitForListed(request: RequestContext, session: SessionRef, cwd: string): Promise<void> {
  await expect.poll(async () => {
    const response = await request.get(`${apiBaseURL}/api/machines/local/sessions?cwd=${encodeURIComponent(cwd)}`);
    const sessions = await response.json() as SessionRef[];
    return sessions.some((listed) => listed.id === session.id);
  }, { timeout: 20_000, message: "the session must be listed before the route can restore it" }).toBe(true);
}

async function archive(request: RequestContext, session: SessionRef, cwd = CWD): Promise<void> {
  await request.post(`${apiBaseURL}/api/machines/local/sessions/${session.id}/stop`, { data: { cwd } });
  await request.post(`${apiBaseURL}/api/machines/local/sessions/${session.id}/archive`, { data: { cwd } });
}

/** Open the app and select the session by id through the app's own router. */
async function openSession(page: Page, session: SessionRef, workspace: WorkspaceRef): Promise<void> {
  await installDeepText(page);
  await page.goto(`/?project=${workspace.projectId}&workspace=${workspace.workspaceId}&session=${session.id}&view=chat`, { waitUntil: "networkidle" });
  await expect(page.locator("pi-web-app")).toBeAttached();
  await page.waitForFunction(() => document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view") !== null, undefined, { timeout: 20_000 });
}

/**
 * Type into the composer the way a person does.
 *
 * The composer is a CodeMirror view inside a shadow root, so the text goes in
 * through a real focus + keyboard sequence rather than by setting a value: a
 * synthetic assignment would bypass the editor's own state and prove nothing
 * about the path the user takes.
 */
async function sendFromComposer(page: Page, text: string): Promise<void> {
  const focused = await page.evaluate(async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot;
      const content = editor?.querySelector<HTMLElement>(".cm-content");
      if (content !== null && content !== undefined) { content.focus(); return true; }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
  });
  expect(focused, "composer must be present and focusable").toBe(true);

  await page.keyboard.type(text, { delay: 10 });
  const clicked = await page.evaluate(() => {
    const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot;
    const button = editor?.querySelector<HTMLElement>(".send-button");
    if (button === null || button === undefined) return false;
    button.click();
    return true;
  });
  expect(clicked, "send button must be present").toBe(true);
}

/**
 * Message bodies render inside `<formatted-text>`, which has its own shadow
 * root, so `textContent` on the bubble stops at the boundary. Text matching has
 * to descend through every open root.
 */
async function installDeepText(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (globalThis as unknown as Record<string, unknown>)["deepText"] = (node: Element | ShadowRoot): string => {
      let text = "";
      for (const child of node.children) {
        text += child.shadowRoot === null || child.shadowRoot === undefined ? (child.textContent ?? "") : (globalThis as unknown as { deepText: (n: Element | ShadowRoot) => string }).deepText(child.shadowRoot);
      }
      return text;
    };
  });
}

declare function deepText(node: Element | ShadowRoot): string;

async function chatState(page: Page): Promise<{ bubbles: number; queuedRows: number }> {
  return await page.evaluate(() => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    const bubbles = [...(chat?.querySelectorAll("article.msg.user") ?? [])]
      .filter((article) => deepText(article).includes("queued from the browser")).length;
    const queuedRows = [...(chat?.querySelectorAll(".queued-message") ?? [])]
      .filter((row) => deepText(row).includes("queued from the browser")).length;
    return { bubbles, queuedRows };
  });
}

async function recallButtons(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    return (chat?.querySelectorAll(".queued-recall-button") ?? []).length;
  });
}

async function deliveryMarks(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    return [...(chat?.querySelectorAll("article.msg.user") ?? [])]
      .filter((article) => deepText(article).includes("queued from the browser"))
      .map((article) => article.querySelector(".delivery-text")?.textContent?.trim() ?? "");
  });
}
