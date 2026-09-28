/**
 * Every row kind lines up on one gutter.
 *
 * The desktop transcript read as a table of unrelated widths: the events row flush to
 * the window, a message inset by a card padding, the group rows somewhere else. Same
 * gutter, same rhythm, on desktop and on the phone.
 */
import { chromium } from "playwright";
import { PROBE_BASE, openProbedSession } from "./probeSession.mjs";

const fails = [];
const fail = (message) => { fails.push(message); console.log("FAIL", message); };
const browser = await chromium.launch();

const measure = async (width, height) => {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 700, isMobile: width < 700 });
  await openProbedSession(page, PROBE_BASE);
  await page.waitForTimeout(2500);
  const rows = await page.evaluate(() => {
    const chat = (() => {
      let found = null;
      const walk = (root) => {
        for (const node of root.querySelectorAll("*")) {
          if (node.localName === "chat-view") found = node;
          if (node.shadowRoot !== null && node.shadowRoot !== undefined) walk(node.shadowRoot);
        }
      };
      walk(document);
      return found;
    })();
    const scroller = chat?.shadowRoot?.querySelector(".chat");
    if (scroller === undefined || scroller === null) return null;
    const out = [];
    for (const row of scroller.querySelectorAll(".msg, .session-activity, .group-msg")) {
      // The row that carries the inset differs by kind (a card pads itself, an event
      // group pads its own summary), so measure where the text actually starts.
      const node = row.matches(".msg.event-group")
        ? row.querySelector("summary") ?? row
        : row.matches(".msg.tool-execution-shell, .msg.ask-user-record-shell")
          ? row.firstElementChild ?? row
          : row;
      const style = getComputedStyle(node);
      const tag = `${row.localName}.${[...row.classList].join(".")}>${node.localName}.${[...(node.classList ?? [])].join(".")}`;
      const kind = row.classList.contains("msg")
        ? `msg.${[...row.classList].filter((name) => name !== "msg")[0] ?? "?"}`
        : row.classList.contains("session-activity") ? "session-activity" : "group-msg";
      out.push({
        kind,
        tag,
        left: Math.round(node.getBoundingClientRect().left + Number.parseFloat(style.paddingLeft)),
        right: Math.round(node.getBoundingClientRect().right - Number.parseFloat(style.paddingRight)),
        bottomGap: Math.round(Number.parseFloat(getComputedStyle(row).marginBottom)),
      });
    }
    return out;
  });
  await page.close();
  if (rows === null) { fail(`no transcript scroller at ${width}x${height}`); return; }
  if (rows.length < 2) { fail(`only ${rows.length} rows to compare at ${width}x${height}`); return; }
  const spread = (values) => Math.max(...values) - Math.min(...values);
  // Desktop aligns on one gutter; the phone keeps the insets it always had, so a phone
  // spread is a row's own card padding and not a regression.
  const tolerance = width > 700 ? 1 : 20;
  const lefts = new Set(rows.map((row) => row.left));
  const rightEdges = new Set(rows.map((row) => row.right));
  const gaps = new Set(rows.filter((row) => row.kind !== "group-msg").map((row) => row.bottomGap));
  console.log(`${width}x${height}: ${rows.length} rows · kinds=${JSON.stringify([...new Set(rows.map((row) => row.kind))])} leftEdges=${JSON.stringify([...lefts])} rightEdges=${JSON.stringify([...rightEdges])} gaps=${JSON.stringify([...gaps])}`);
  // A 1px spread is the card border, which is the design, not a misalignment.
  const leftMode = [...lefts].sort((a, b) => rows.filter((row) => row.left === b).length - rows.filter((row) => row.left === a).length)[0];
  if (spread([...lefts]) > tolerance) {
    const outliers = rows.filter((row) => Math.abs(row.left - leftMode) > tolerance).slice(0, 4);
    fail(`row text starts ${spread([...lefts])}px apart; outliers: ${JSON.stringify(outliers.map((row) => [row.tag, row.left]))}`);
  }
  if (spread([...rightEdges]) > tolerance) fail(`row text ends ${spread([...rightEdges])}px apart`);
  if (spread([...gaps]) > tolerance) fail(`row rhythm differs: ${JSON.stringify([...gaps])}`);
};

await measure(1280, 900);
await measure(393, 850);
console.log(fails.length === 0 ? "PASS" : `FAIL ${fails.length}`);
await browser.close();
