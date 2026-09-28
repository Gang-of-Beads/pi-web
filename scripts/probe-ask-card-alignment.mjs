/**
 * An open question card lines up with the message cards above it.
 *
 * The owner reported the card "broken" on the phone: it sat a gutter narrower than
 * every message box. The margin template (rowGroups) says a row that draws its own box
 * aligns its box with the other boxes; the waiting slot was classed as a bare row and
 * padded, and the card padded its own host as well. This measures the live card box and
 * its question text against a real message box and its text, at phone and desktop width.
 */
import { chromium } from "playwright";
import { PROBE_BASE, openProbedSession } from "./probeSession.mjs";

const fails = [];
const fail = (message) => { fails.push(message); console.log("FAIL", message); };

const ASK = {
  askId: "probe-alignment",
  askedAt: new Date().toISOString(),
  questions: [
    { id: "a", question: "How should this ship?", detail: "Probe question", options: [{ value: "x", label: "Ship now" }, { value: "y", label: "Wait" }] },
    { id: "b", question: "Anything else?", options: [] },
  ],
};

async function measure(viewport, label) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport, hasTouch: viewport.width < 640, isMobile: viewport.width < 640 });
  await openProbedSession(page, PROBE_BASE);
  await page.waitForTimeout(2500);
  const result = await page.evaluate(async (ask) => {
    const find = (root) => {
      for (const node of root.querySelectorAll("*")) {
        if (node.tagName === "CHAT-VIEW") return node;
        if (node.shadowRoot) {
          const inner = find(node.shadowRoot);
          if (inner) return inner;
        }
      }
      return null;
    };
    const view = find(document);
    if (view === null) return { error: "no chat-view" };
    view.pendingAsk = ask;
    view.pendingAsks = [ask];
    await view.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 400));
    const root = view.shadowRoot;
    const message = [...root.querySelectorAll(".msg.assistant, .msg.user")].find((node) => node.getBoundingClientRect().width > 0);
    const card = root.querySelector(".waiting-slot ask-user-card");
    if (message === undefined || card === null) return { error: `message=${String(message !== undefined)} card=${String(card !== null)}` };
    await card.updateComplete;
    const box = card.shadowRoot?.querySelector(".card, form, section, .ask") ?? card.shadowRoot?.firstElementChild;
    const boxRect = [...(card.shadowRoot?.querySelectorAll("*") ?? [])]
      .map((node) => ({ node, rect: node.getBoundingClientRect(), style: getComputedStyle(node) }))
      .find(({ rect, style }) => rect.width > 0 && style.borderLeftWidth !== "0px" && style.borderLeftStyle !== "none")?.rect ?? box?.getBoundingClientRect();
    const messageRect = message.getBoundingClientRect();
    const messageBody = message.querySelector(".msg-body, .content, .markdown, p") ?? message;
    const questionText = card.shadowRoot?.querySelector(".question-text, .question, h3, legend, strong");
    return {
      messageBox: [Math.round(messageRect.left), Math.round(messageRect.right)],
      cardBox: boxRect === undefined ? null : [Math.round(boxRect.left), Math.round(boxRect.right)],
      messageTextLeft: Math.round(messageBody.getBoundingClientRect().left),
      questionTextLeft: questionText === null || questionText === undefined ? null : Math.round(questionText.getBoundingClientRect().left),
    };
  }, ASK);
  await page.screenshot({ path: `/tmp/ask-alignment-${label}.png` });
  await browser.close();
  console.log(label, JSON.stringify(result));
  if (result.error !== undefined) { fail(`${label}: precondition missing - ${result.error}`); return; }
  if (result.cardBox === null) { fail(`${label}: no card box found`); return; }
  if (Math.abs(result.cardBox[0] - result.messageBox[0]) > 1) fail(`${label}: card box left ${String(result.cardBox[0])} vs message box left ${String(result.messageBox[0])}`);
  if (Math.abs(result.cardBox[1] - result.messageBox[1]) > 1) fail(`${label}: card box right ${String(result.cardBox[1])} vs message box right ${String(result.messageBox[1])}`);
}

await measure({ width: 393, height: 850 }, "phone");
await measure({ width: 1280, height: 900 }, "desktop");
console.log(fails.length === 0 ? "PASS ask-card-alignment" : `FAIL ask-card-alignment (${String(fails.length)})`);
process.exit(fails.length === 0 ? 0 : 1);
