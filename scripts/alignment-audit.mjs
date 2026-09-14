import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = "http://127.0.0.1:8505";
const TOLERANCE = 1.5;

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: "dark" });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("pi-web-app", { timeout: 15000 });
await page.waitForTimeout(3000);
await page.evaluate(`(async function(){
  const app = document.querySelector("pi-web-app");
  const state = Reflect.get(app, "state");
  const project = state.projects.find((p) => p.path === "/private/tmp/test");
  await Reflect.get(app, "workspaces").selectProject(project);
  await new Promise((r) => setTimeout(r, 1500));
  await Reflect.get(app, "workspaces").selectWorkspace(Reflect.get(app, "state").workspaces[0]);
  await new Promise((r) => setTimeout(r, 2500));
  const rows = document.querySelectorAll("session-list button");
  let target = null;
  for (const b of rows) { if ((b.textContent || "").includes("messages")) target = b; }
  target?.click();
  await new Promise((r) => setTimeout(r, 2200));
})()`);

// Alignment audit: for every button that contains exactly one svg icon (icon
// buttons), compare the svg's center against the button's content-box center.
// Also check chips/badges' text centering vs their pill box.
const audit = await page.evaluate(`(function(){
  const findings = [];
  const buttons = [];
  const visit = (root, path) => {
    for (const node of root.querySelectorAll("*")) {
      if (node.tagName === "BUTTON" || node.getAttribute?.("role") === "button") {
        const r = node.getBoundingClientRect();
        if (r.width > 8 && r.height > 8) buttons.push({ node, path: path + ">" + node.tagName.toLowerCase() + "." + String(node.className).split(" ").slice(0, 1).join("") });
      }
      if (node.shadowRoot) visit(node.shadowRoot, path + ">" + node.tagName.toLowerCase());
    }
  };
  visit(document, "");
  for (const entry of buttons) {
    const button = entry.node;
    const br = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderRight = parseFloat(style.borderRightWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    const contentX = br.left + borderLeft;
    const contentY = br.top + borderTop;
    const contentW = br.width - borderLeft - borderRight;
    const contentH = br.height - borderTop - borderBottom;
    const svgs = button.querySelectorAll("svg");
    const ownText = button.textContent.trim();
    const elementChildren = [...button.children].filter((c) => c.tagName !== "SVG").length;
    if (svgs.length === 1 && ownText === "" && elementChildren === 0) {
      const sr = svgs[0].getBoundingClientRect();
      const iconCx = sr.left + sr.width / 2;
      const iconCy = sr.top + sr.height / 2;
      const boxCx = contentX + contentW / 2;
      const boxCy = contentY + contentH / 2;
      const dx = iconCx - boxCx;
      const dy = iconCy - boxCy;
      if (Math.abs(dx) > ${TOLERANCE} || Math.abs(dy) > ${TOLERANCE}) {
        findings.push({ kind: "icon-button", where: entry.path.slice(-70), dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10, box: Math.round(contentW) + "x" + Math.round(contentH), border: borderLeft + "/" + borderTop });
      }
    }
  }
  // Pill/chip text centering: any element with a pill radius and short text,
  // compare the text's rendered box center against the pill box center.
  const pills = [];
  const visitPills = (root, path) => {
    for (const node of root.querySelectorAll("*")) {
      const style = getComputedStyle(node);
      const radius = parseFloat(style.borderTopLeftRadius) || 0;
      const r = node.getBoundingClientRect();
      if (radius >= 8 && r.height >= 14 && r.height <= 40 && r.width >= 30 && node.childElementCount === 0 && (node.textContent ?? "").trim().length > 0 && (node.textContent ?? "").trim().length < 24) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const tr = range.getBoundingClientRect();
        if (tr.width > 0) {
          const dx = (tr.left + tr.width / 2) - (r.left + r.width / 2);
          const dy = (tr.top + tr.height / 2) - (r.top + r.height / 2);
          if (Math.abs(dx) > ${TOLERANCE} || Math.abs(dy) > ${TOLERANCE}) {
            pills.push({ where: path + ">" + node.tagName.toLowerCase() + "." + String(node.className).split(" ").slice(0, 1).join(""), text: (node.textContent ?? "").trim().slice(0, 16), dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10, pad: style.padding });
          }
        }
      }
      if (node.shadowRoot) visitPills(node.shadowRoot, path + ">" + node.tagName.toLowerCase());
    }
  };
  visitPills(document, "");
  const pillFindings = pills.slice(0, 20);
  pills.length = 0;
  return { checked: buttons.length, iconMisaligned: findings.length, iconFindings: findings.slice(0, 8), pillMisaligned: pillFindings, pillsProxy: pills };
})()`);

writeFileSync("/tmp/journeys/alignment-audit.json", JSON.stringify(audit, null, 2));
console.log("buttons checked:", audit.checked);
for (const finding of audit.iconFindings) console.log(`  ICON dx=${finding.dx} dy=${finding.dy} ${finding.where}`);
for (const finding of audit.pillMisaligned) console.log(`  PILL dx=${finding.dx} dy=${finding.dy} "${finding.text}" ${finding.where} pad=${finding.pad}`);
await browser.close();
