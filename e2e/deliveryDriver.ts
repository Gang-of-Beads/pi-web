import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { apiBaseURL } from "../playwright.config";
import { CONTAINER_HOME, createProject, firstWorkspace, type WorkspaceRef } from "./fixtures";

/**
 * Driving a real session through the states a message passes on its way to the
 * agent (docs/message-delivery-design.md).
 *
 * These helpers are shared by every delivery spec rather than copied into each
 * one: the states are only observable while the agent is busy, and each spec
 * getting there its own way is how one of them ends up asserting against a
 * session that has already gone idle.
 *
 * The busy window comes from the mock provider (`e2e/mockLlm.mjs`, 60 chunks x
 * 300ms served inside the container at 127.0.0.1:18999), so a turn lasts about
 * 18s. A prompt containing FASTMOCK answers in a single chunk, which is how a
 * queued message that has been read stops costing another slow turn.
 */

/** Session cwd for API-only checks; UI checks need a registered project. */
export const CWD = "/workspace";
export const MOCK_MODEL = { provider: "mock", modelId: "mock-model" };

/**
 * The container that runs pi, and therefore the one whose localhost the mock
 * provider has to answer on: `/data/pi-agent/models.json` points the `mock`
 * provider at `http://127.0.0.1:18999/v1`.
 */
const SESSIOND_CONTAINER = process.env["PI_WEB_E2E_SESSIOND_CONTAINER"] ?? "pi-web-fork-verify-sessiond-1";
const MOCK_LLM_SCRIPT = "/workspace/e2e/mockLlm.mjs";
/** chunks x delay: the busy window every queue assertion has to fit inside. */
const MOCK_TURN_MS = 18_000;

/**
 * Make sure the slow provider is actually serving before a suite assumes a
 * turn takes seconds.
 *
 * Without it the session still "streams": pi retries a refused connection with
 * a growing backoff, so `isStreaming` stays true and messages queue for a
 * window nobody chose. Tests then pass for the wrong reason and no message is
 * ever read, which is exactly the assertion a recall test depends on.
 */
export async function ensureMockLlm(): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const health = "curl -sf --max-time 2 http://127.0.0.1:18999/health";
  const { stdout } = await run("docker", [
    "exec", SESSIOND_CONTAINER, "bash", "-lc",
    // Started detached with its output on disk: an inherited stdout would keep
    // `docker exec` waiting for a server that never exits.
    `${health} >/dev/null 2>&1 || { nohup node ${MOCK_LLM_SCRIPT} --chunks=60 --delay=300 >/tmp/mock-llm.log 2>&1 & sleep 1; }; ${health}`,
  ]);
  const reported = JSON.parse(stdout) as { ok?: boolean; chunks?: number; delay?: number };
  expect(reported.ok, `mock provider must answer inside ${SESSIOND_CONTAINER}`).toBe(true);
  // A mock started with different flags would shorten the busy window until the
  // queue assertions race it, which is a failure worth naming here rather than
  // debugging in whichever test lost the race.
  expect((reported.chunks ?? 0) * (reported.delay ?? 0), "the mock turn must stay long enough to queue behind").toBeGreaterThanOrEqual(MOCK_TURN_MS);
}

export interface SessionRef { id: string }

export interface QueuedMessage {
  kind: string;
  text: string;
  clientMessageId?: string;
}

export interface StatusBody {
  isStreaming?: boolean;
  queuedMessages?: QueuedMessage[];
}

type RequestContext = Page["request"];

export function promptPath(session: SessionRef): string {
  return `${apiBaseURL}/api/machines/local/sessions/${session.id}/prompt`;
}

/** A stable project so repeated runs do not bury the container in fixtures. */
export async function deliveryWorkspace(request: APIRequestContext): Promise<WorkspaceRef> {
  const name = "e2e-fixture-delivery";
  const projectId = await createProject(request, name, `${CONTAINER_HOME}/${name}`);
  return await firstWorkspace(request, projectId);
}

export async function createSession(request: RequestContext, cwd = CWD): Promise<SessionRef> {
  const created = await request.post(`${apiBaseURL}/api/machines/local/sessions`, { data: { cwd } });
  expect(created.ok(), "create session").toBe(true);
  return await created.json() as SessionRef;
}

export async function setMockModel(request: RequestContext, session: SessionRef, cwd = CWD): Promise<void> {
  const response = await request.post(`${apiBaseURL}/api/machines/local/sessions/${session.id}/model`, { data: { cwd, ...MOCK_MODEL } });
  expect(response.ok(), "point the session at the mock provider").toBe(true);
}

/** Start the slow turn everything else queues behind. */
export async function startSlowTurn(request: RequestContext, session: SessionRef, cwd = CWD): Promise<void> {
  const started = await request.post(promptPath(session), { data: { cwd, text: "first, take your time" } });
  expect(started.ok(), "start the turn a message can queue behind").toBe(true);
  await waitForStreaming(request, session, cwd);
}

export async function abortTurn(request: RequestContext, session: SessionRef, cwd = CWD): Promise<void> {
  const aborted = await request.post(`${apiBaseURL}/api/machines/local/sessions/${session.id}/abort`, { data: { cwd } });
  expect(aborted.ok(), "abort the turn").toBe(true);
}

/**
 * A session the app's route can restore, with the agent left idle.
 *
 * The route only restores a session the workspace listing has published, and a
 * session is listed once its first prompt has put a transcript on disk. That
 * prompt is then aborted rather than waited out, because the busy window a
 * delivery test needs has to start *after* the page is up: opening the app
 * costs about as long as a mock turn lasts, so a turn started before the
 * navigation is usually over before the first keystroke.
 */
export async function seedListedSession(request: RequestContext, session: SessionRef, cwd: string): Promise<void> {
  const seeded = await request.post(promptPath(session), { data: { cwd, text: "seed the transcript" } });
  expect(seeded.ok(), "seed the session transcript").toBe(true);
  await waitForStreaming(request, session, cwd);
  await abortTurn(request, session, cwd);
  await waitForListed(request, session, cwd);
  await expect.poll(async () => (await status(request, session, cwd)).isStreaming, { timeout: 20_000, message: "the seed turn must be over before the window opens" }).toBe(false);
}

export async function status(request: RequestContext, session: SessionRef, cwd = CWD): Promise<StatusBody> {
  const response = await request.get(`${apiBaseURL}/api/machines/local/sessions/${session.id}/status?cwd=${encodeURIComponent(cwd)}`);
  expect(response.ok()).toBe(true);
  return await response.json() as StatusBody;
}

export async function waitForStreaming(request: RequestContext, session: SessionRef, cwd = CWD): Promise<void> {
  await expect.poll(async () => (await status(request, session, cwd)).isStreaming, { timeout: 20_000, message: "the first turn must be running" }).toBe(true);
}

export async function waitForQueued(request: RequestContext, session: SessionRef, cwd = CWD, count = 1): Promise<StatusBody> {
  await expect.poll(async () => (await status(request, session, cwd)).queuedMessages?.length ?? 0, { timeout: 20_000, message: `${String(count)} message(s) must queue` })
    .toBeGreaterThanOrEqual(count);
  return await status(request, session, cwd);
}

export async function waitForListed(request: RequestContext, session: SessionRef, cwd: string): Promise<void> {
  await expect.poll(async () => {
    const response = await request.get(`${apiBaseURL}/api/machines/local/sessions?cwd=${encodeURIComponent(cwd)}`);
    const sessions = await response.json() as SessionRef[];
    return sessions.some((listed) => listed.id === session.id);
  }, { timeout: 20_000, message: "the session must be listed before the route can restore it" }).toBe(true);
}

/**
 * The user messages the agent actually read, from the transcript on disk.
 *
 * A queued message is written to the transcript when the turn consumes it, not
 * when it is accepted, so this is the only place that answers "what did the
 * agent end up reading, and in what order" - which is the question a recall
 * has to get right.
 */
export async function readUserMessages(request: RequestContext, session: SessionRef, cwd: string): Promise<string[]> {
  const response = await request.get(`${apiBaseURL}/api/machines/local/sessions/${session.id}/messages?cwd=${encodeURIComponent(cwd)}&limit=50`);
  expect(response.ok()).toBe(true);
  const page = await response.json() as { messages: { role: string; content: { type: string; text?: string }[] }[] };
  return page.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join(""));
}

export async function archive(request: RequestContext, session: SessionRef, cwd = CWD): Promise<void> {
  await request.post(`${apiBaseURL}/api/machines/local/sessions/${session.id}/stop`, { data: { cwd } });
  await request.post(`${apiBaseURL}/api/machines/local/sessions/${session.id}/archive`, { data: { cwd } });
}

/** Open the app and select the session by id through the app's own router. */
export async function openSession(page: Page, session: SessionRef, workspace: WorkspaceRef): Promise<void> {
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
 * about the path the user takes. Focusing does not move the caret, so typing
 * after a recall appends to the text that came back.
 */
export async function typeInComposer(page: Page, text: string): Promise<void> {
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
}

export async function clickSend(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot;
    const button = editor?.querySelector<HTMLElement>(".send-button");
    if (button === null || button === undefined) return false;
    button.click();
    return true;
  });
  expect(clicked, "send button must be present").toBe(true);
}

export async function sendFromComposer(page: Page, text: string): Promise<void> {
  await typeInComposer(page, text);
  await clickSend(page);
}

/**
 * Whether the browser itself believes the agent is working.
 *
 * Read from the stop button rather than from the API: it is the control the
 * user presses, and a test that types before the browser knows the session is
 * busy is sending into a different state than the one it means to assert on.
 */
export async function stopOffered(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const button = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot
      ?.querySelector<HTMLButtonElement>(".stop-button");
    return button !== null && button !== undefined && !button.disabled;
  });
}

export async function waitForBusyComposer(page: Page): Promise<void> {
  await expect.poll(async () => await stopOffered(page), { timeout: 20_000, message: "the browser must see the agent as busy before a message can queue" }).toBe(true);
}

/** Press stop, which cancels the turn and hands the queue back. */
export async function clickStop(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const button = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot
      ?.querySelector<HTMLButtonElement>(".stop-button");
    if (button === null || button === undefined || button.disabled) return false;
    button.click();
    return true;
  });
  expect(clicked, "stop must be offered while the agent is working").toBe(true);
}

/** What is in the composer, line by line, as the editor holds it. */
export async function composerText(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const content = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot
      ?.querySelector(".cm-content");
    if (content === null || content === undefined) return "";
    // Line elements, not `textContent`: CodeMirror renders each line as its own
    // element, so reading the container would join two lines into one word.
    return [...content.querySelectorAll(".cm-line")].map((line) => line.textContent ?? "").join("\n");
  });
}

/**
 * Message bodies render inside `<formatted-text>`, which has its own shadow
 * root, so `textContent` on the bubble stops at the boundary. Text matching has
 * to descend through every open root.
 */
export async function installDeepText(page: Page): Promise<void> {
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

/** Every user bubble in the transcript, in the order it is rendered. */
export async function userBubbleTexts(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    return [...(chat?.querySelectorAll("article.msg.user") ?? [])].map((article) => deepText(article));
  });
}

/**
 * Rows of the queued-message panel. A message that already has a bubble must
 * never appear here as well, so this is what "no duplicate" is measured against.
 */
export async function queuedRowTexts(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    return [...(chat?.querySelectorAll(".queued-message") ?? [])].map((row) => deepText(row));
  });
}

/**
 * Messages the server is holding, as the reader sees them: each is drawn in the
 * transcript in the order the queue will send it, carrying a "Queued" mark. One
 * posted by another client is given a line of its own rather than a panel row.
 */
export async function queuedTranscriptTexts(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    return [...(chat?.querySelectorAll("article.msg.user") ?? [])]
      .filter((row) => (row.querySelector(".delivery-text")?.textContent ?? "").startsWith("Queued"))
      .map((row) => deepText(row));
  });
}

export function countContaining(texts: string[], needle: string): number {
  return texts.filter((text) => text.includes(needle)).length;
}

/** Bubbles the server still holds, which is what the pending colour marks. */
export async function queuedBubbles(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    return (chat?.querySelectorAll("article.msg.user.queued") ?? []).length;
  });
}

export async function recallButtons(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    return (chat?.querySelectorAll('[data-action="recall"]') ?? []).length;
  });
}

/**
 * Recall one message by its text, from wherever it is shown: a message this
 * browser sent carries the action on its own bubble, and one that arrived from
 * elsewhere carries it in the queued-message panel.
 */
export async function clickRecall(page: Page, needle: string): Promise<void> {
  const outcome = await page.evaluate((text) => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    const holders = [...(chat?.querySelectorAll("article.msg.user, .queued-message") ?? [])]
      .filter((candidate) => deepText(candidate).includes(text));
    // The bubble and the panel row can both match while only one of them owns
    // the action, so the holder is chosen by having it rather than by coming
    // first in the document.
    const button = holders.map((holder) => holder.querySelector<HTMLElement>('[data-action="recall"]')).find((candidate) => candidate !== null);
    if (button === null || button === undefined) {
      return { clicked: false, holders: holders.map((holder) => deepText(holder).replace(/\s+/gu, " ").slice(0, 80)) };
    }
    button.click();
    return { clicked: true, holders: [] as string[] };
  }, needle);
  expect(outcome.clicked, `a queued message containing "${needle}" must offer a recall action (matched: ${JSON.stringify(outcome.holders)})`).toBe(true);
}

/** The delivery marks on the bubbles whose text contains `needle`. */
export async function deliveryMarks(page: Page, needle: string): Promise<string[]> {
  return await page.evaluate((text) => {
    const chat = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view")?.shadowRoot;
    return [...(chat?.querySelectorAll("article.msg.user") ?? [])]
      .filter((article) => deepText(article).includes(text))
      .map((article) => article.querySelector(".delivery-text")?.textContent?.trim() ?? "");
  }, needle);
}
