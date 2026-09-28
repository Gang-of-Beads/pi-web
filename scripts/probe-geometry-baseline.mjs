/**
 * Phone and desktop geometry cannot move each other without saying so.
 *
 * The owner, after the question card lost 20px a side on his phone: "手机版之前都调好的，你为了
 * 改desktop全给变了 ... 手机端和desktop端要么分开改，要么你就保证别互相影响". This measures the
 * surfaces a reader lines up by eye - message box and label inset, the event summary, the
 * rows (and so the tool boxes) inside a live-events group, the open question card and the
 * extension dialog card - at a
 * phone and a desktop width, and compares each number with the committed baseline. Any drift
 * fails. A deliberate change is recorded with `--update`, which makes it a reviewed diff of
 * scripts/geometry-baseline.json instead of a side effect.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PROBE_BASE, openProbedSession } from "./probeSession.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, "geometry-baseline.json");
const update = process.argv.includes("--update");
const TOLERANCE = 1;
const WIDTHS = { phone: { width: 393, height: 850, mobile: true }, desktop: { width: 1280, height: 900, mobile: false } };

const fails = [];
const fail = (message) => { fails.push(message); console.log("FAIL", message); };

async function measure({ width, height, mobile }) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
  await openProbedSession(page, PROBE_BASE);
  await page.waitForTimeout(2500);
  const numbers = await page.evaluate(async () => {
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
    if (view === null || view.shadowRoot === null) return { error: "no chat-view" };
    const ask = { askId: "geometry", askedAt: "", questions: [{ id: "q", question: "Geometry probe", detail: "detail", options: [{ value: "a", label: "Option" }] }] };
    const dialogs = view.pendingDialogs.length > 0 ? view.pendingDialogs : [{ id: "geometry-dialog", kind: "confirm", title: "Geometry dialog", message: "" }];
    const pinned = { pendingAsk: ask, pendingAsks: [ask], pendingDialogs: dialogs };
    for (const [name, value] of Object.entries(pinned)) Object.defineProperty(view, name, { configurable: true, get: () => value, set: () => undefined });
    view.requestUpdate();
    await view.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 500));
    const root = view.shadowRoot;
    const edges = (node) => {
      if (node === null || node === undefined) return null;
      const rect = node.getBoundingClientRect();
      return rect.width === 0 ? null : [Math.round(rect.left), Math.round(rect.right)];
    };
    const textLeft = (node) => {
      if (node === null || node === undefined) return null;
      const rect = node.getBoundingClientRect();
      return rect.width === 0 ? null : Math.round(rect.left + parseFloat(getComputedStyle(node).paddingLeft));
    };
    const boxedChild = async (host) => {
      if (host === null || host === undefined) return null;
      await host.updateComplete;
      const bordered = [...(host.shadowRoot?.querySelectorAll("*") ?? [])].find((node) => {
        const style = getComputedStyle(node);
        return node.getBoundingClientRect().width > 0 && style.borderLeftStyle !== "none" && style.borderLeftWidth !== "0px";
      });
      return edges(bordered ?? host);
    };
    const message = [...root.querySelectorAll(".msg.assistant, .msg.user")].find((node) => node.getBoundingClientRect().width > 0);
    const groups = [...root.querySelectorAll("details.msg.event-group")].filter((node) => node.getBoundingClientRect().width > 0);
    let group = groups.find((node) => node.querySelector(".group-msg") !== null);
    if (group === undefined && groups.length > 0) {
      group = groups[groups.length - 1];
      group.querySelector(":scope > summary")?.click();
      await view.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const groupRow = group?.querySelector(".group-msg");
    const groupRect = group?.getBoundingClientRect();
    const rowRect = groupRow?.getBoundingClientRect();
    const result = {
      messageBox: edges(message),
      messageLabelLeft: edges(message?.querySelector(".msg-header .label"))?.[0] ?? null,
      eventSummaryTextLeft: textLeft(root.querySelector(".msg.event-group > summary")),
      questionCardBox: await boxedChild(root.querySelector(".waiting-slot ask-user-card")),
      dialogCardBox: await boxedChild(root.querySelector(".waiting-slot extension-dialog-card")),
      groupContentInset: groupRect === undefined || rowRect === undefined || rowRect.width === 0 || groupRow === null || groupRow === undefined
        ? null
        : [Math.round(rowRect.left + parseFloat(getComputedStyle(groupRow).paddingLeft) - groupRect.left), Math.round(groupRect.right - rowRect.right + parseFloat(getComputedStyle(groupRow).paddingRight))],
    };
    for (const name of Object.keys(pinned)) Reflect.deleteProperty(view, name);
    view.requestUpdate();
    return result;
  });
  await page.screenshot({ path: `/tmp/geometry-${String(width)}.png` });
  await browser.close();
  return numbers;
}

const measured = {};
for (const [name, viewport] of Object.entries(WIDTHS)) {
  measured[name] = await measure(viewport);
  console.log(name, JSON.stringify(measured[name]));
  if (measured[name].error !== undefined) fail(`${name}: precondition missing - ${measured[name].error}`);
  for (const [key, value] of Object.entries(measured[name])) {
    if (key !== "error" && value === null) fail(`${name}: ${key} could not be measured - precondition missing`);
  }
}

if (update) {
  if (fails.length > 0) {
    console.log("refusing to record a baseline with missing measurements");
    process.exit(1);
  }
  writeFileSync(baselinePath, `${JSON.stringify(measured, null, 2)}\n`);
  console.log(`recorded ${baselinePath}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const differs = (a, b) => (Array.isArray(a) ? a.some((value, index) => Math.abs(value - b[index]) > TOLERANCE) : Math.abs(a - b) > TOLERANCE);
for (const [name, numbers] of Object.entries(baseline)) {
  for (const [key, expected] of Object.entries(numbers)) {
    const actual = measured[name]?.[key];
    if (actual === null || actual === undefined) continue;
    if (differs(actual, expected)) fail(`${name} ${key} moved: baseline ${JSON.stringify(expected)}, now ${JSON.stringify(actual)}`);
  }
}
console.log(fails.length === 0 ? "PASS geometry-baseline: phone and desktop unchanged" : `FAIL geometry-baseline (${String(fails.length)})`);
process.exit(fails.length === 0 ? 0 : 1);
