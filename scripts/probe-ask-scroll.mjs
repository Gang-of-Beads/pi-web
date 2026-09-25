#!/usr/bin/env node
/**
 * Does an open question form move the transcript under the reader?
 *
 * Report: "总是回弹" and the hunch that it is tied to ask_user. The form is a
 * real row of the layout, and while it is open the activity dock is removed -
 * so the scroller gains its height, then loses it again when the form settles.
 * This opens a form through the model, scrolls away from the bottom, and
 * records which of the movers ran on the frame of each jump.
 */

import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
const MODEL = process.env.PI_WEB_PROBE_MODEL ?? "anthropic/claude-haiku-4-5";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
try {
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);

  const out = await page.evaluate(async (model) => {
    const app = document.querySelector("pi-web-app");
    const board = [...app.shadowRoot.querySelectorAll("app-navigate-page")].find((surface) => surface.getBoundingClientRect().width > 0);
    if (board !== undefined) {
      board.shadowRoot.querySelector(".row.session")?.click();
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    const view = app.shadowRoot.querySelector("chat-view");
    const root = view?.shadowRoot;
    const chat = root?.querySelector(".chat");
    if (chat === undefined || chat === null) return "no transcript";

    const calls = [];
    for (const name of ["holdBottomEdge", "scrollToBottom", "restoreScrollPosition", "onViewportResize", "renderWaitingForYou", "renderActivityDock"]) {
      const original = Reflect.get(view, name);
      if (typeof original !== "function") continue;
      Reflect.set(view, name, function counted(...args) {
        calls.push({ at: performance.now(), name, top: Math.round(chat.scrollTop), height: Math.round(chat.scrollHeight), client: Math.round(chat.clientHeight) });
        return Reflect.apply(original, this, args);
      });
    }

    const sessions = Reflect.get(app, "sessions");
    const [provider, ...rest] = model.split("/");
    await Reflect.apply(Reflect.get(sessions, "setModel"), sessions, [provider, rest.join("/")]);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    void Reflect.apply(Reflect.get(sessions, "send"), sessions, [
      "Call ask_user exactly once with one question 'is the form up?' and one option 'yes'. Say nothing else.",
    ]);
    for (let waited = 0; waited < 120_000; waited += 500) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (root.querySelector("ask-user-card") !== null) break;
    }
    if (root.querySelector("ask-user-card") === null) return "the model never asked";
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Phase one: stay pinned to the bottom while the form settles. Removing the
    // row shrinks the content, and the scroller only corrects growth, so this is
    // where a pinned reader can be yanked upward.
    const pinnedBefore = { top: Math.round(chat.scrollTop), max: Math.round(chat.scrollHeight - chat.clientHeight) };
    chat.scrollTop = chat.scrollHeight;
    await new Promise((resolve) => setTimeout(resolve, 800));
    const pinnedFrames = [];
    const pinnedDeadline = performance.now() + 4000;
    const samplePinned = () => {
      pinnedFrames.push({ at: performance.now(), top: Math.round(chat.scrollTop), max: Math.round(chat.scrollHeight - chat.clientHeight) });
      if (performance.now() < pinnedDeadline) requestAnimationFrame(samplePinned);
    };
    requestAnimationFrame(samplePinned);
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const submitPinned = root.querySelector("ask-user-card")?.shadowRoot?.querySelector("button[type=submit]");
    submitPinned?.click();
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const pinnedJumps = [];
    for (let i = 1; i < pinnedFrames.length; i += 1) {
      const delta = pinnedFrames[i].top - pinnedFrames[i - 1].top;
      if (Math.abs(delta) < 20) continue;
      pinnedJumps.push(`Δ${String(delta)}px ${String(pinnedFrames[i - 1].top)}->${String(pinnedFrames[i].top)} max ${String(pinnedFrames[i - 1].max)}->${String(pinnedFrames[i].max)}`);
    }
    const pinnedEnd = pinnedFrames.length === 0 ? undefined : pinnedFrames[pinnedFrames.length - 1];
    const distanceFromBottom = pinnedEnd === undefined ? -1 : pinnedEnd.max - pinnedEnd.top;

    // Phase two: the same while reading part-way up.
    chat.scrollTop = Math.max(0, chat.scrollHeight - chat.clientHeight - 1800);
    const marker = performance.now();
    const frames = [];
    const deadline = performance.now() + 9000;
    const sample = () => {
      frames.push({ at: performance.now(), top: Math.round(chat.scrollTop), height: Math.round(chat.scrollHeight), client: Math.round(chat.clientHeight) });
      if (performance.now() < deadline) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    // Settle the form, which removes the row and brings the dock back.
    const submit = root.querySelector("ask-user-card")?.shadowRoot?.querySelector("button[type=submit]");
    submit?.click();
    await new Promise((resolve) => setTimeout(resolve, 6000));

    // Phase three: the top of the transcript, where earlier history is paged in
    // above the reader.
    chat.scrollTop = 0;
    const topMarker = performance.now();
    const topFrames = [];
    const topDeadline = performance.now() + 12_000;
    const sampleTop = () => {
      topFrames.push({ at: performance.now(), top: Math.round(chat.scrollTop), height: Math.round(chat.scrollHeight) });
      if (performance.now() < topDeadline) requestAnimationFrame(sampleTop);
    };
    requestAnimationFrame(sampleTop);
    await new Promise((resolve) => setTimeout(resolve, 13_000));
    const topJumps = [];
    for (let i = 1; i < topFrames.length; i += 1) {
      const delta = topFrames[i].top - topFrames[i - 1].top;
      if (Math.abs(delta) < 30) continue;
      const callers = calls.filter((call) => call.at <= topFrames[i].at + 2 && call.at >= topFrames[i - 1].at - 40).map((call) => call.name);
      topJumps.push(`Δ${String(delta)}px ${String(topFrames[i - 1].top)}->${String(topFrames[i].top)} h${String(topFrames[i - 1].height)}->${String(topFrames[i].height)} via ${callers.join(",") || "none"}`);
    }

    const jumps = [];
    for (let i = 1; i < frames.length; i += 1) {
      const delta = frames[i].top - frames[i - 1].top;
      if (Math.abs(delta) < 30) continue;
      const callers = calls
        .filter((call) => call.at <= frames[i].at + 2 && call.at >= frames[i - 1].at - 40)
        .map((call) => `${call.name}(h${String(call.height)}/c${String(call.client)})`);
      jumps.push(`Δ${String(delta)}px ${String(frames[i - 1].top)}->${String(frames[i].top)} h${String(frames[i].height)}/${String(frames[i].client)} via ${callers.join(",") || "none"}`);
    }
    return {
      pinnedBefore,
      pinnedJumps: pinnedJumps.slice(0, 6),
      distanceFromBottomAfterSettle: distanceFromBottom,
      readingFrames: frames.length,
      readingJumps: jumps.slice(0, 6),
      topJumps: topJumps.slice(0, 8),
      calls: calls.filter((call) => call.at > marker).length,
    };
  }, MODEL);

  console.log(JSON.stringify(out, null, 1));
} finally {
  await browser.close();
}
