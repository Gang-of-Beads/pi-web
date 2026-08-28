/**
 * Collapsing the navigation panel on a desktop took away the only thing that
 * named the machine, project, workspace and session. Check that the shell
 * still says where you are once the panel is gone.
 *
 * Usage: node scripts/verify-identity-when-collapsed.mjs [port]
 */
import { deepClick, enterBusiestSession, openApp } from "./lib/liveApp.mjs";

const port = process.argv[2] ?? "8505";
const app = await openApp({ port });

const session = await enterBusiestSession(app.page);
if (session === undefined) {
  console.error("FAIL: no conversation was reached, so collapsing the panel proved nothing");
  await app.close();
  process.exit(1);
}

const shellSays = () => app.page.evaluate(() => {
  const root = document.querySelector("pi-web-app")?.shadowRoot;
  const panel = root?.querySelector("app-navigation-panel, .navigation-panel, .mobile-navigation-panel");
  const words = [];
  const walk = (node) => {
    for (const el of node.querySelectorAll("*")) {
      // The conversation is full of project names; only the shell counts.
      if (el.tagName === "CHAT-VIEW") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      for (const child of el.childNodes) if (child.nodeType === 3 && (child.textContent ?? "").trim()) words.push(child.textContent.trim());
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  if (root) walk(root);
  return { panelWidth: panel === null || panel === undefined ? 0 : Math.round(panel.getBoundingClientRect().width), text: words.join(" | ").replace(/\s+/gu, " ") };
});

const before = await shellSays();
if (before.panelWidth === 0) {
  console.error("FAIL: the navigation panel was not showing to begin with, so collapsing it was never tested");
  await app.close();
  process.exit(1);
}

const collapsed = await deepClick(app.page, "collapse navigation");
await app.page.waitForTimeout(1500);
const after = await shellSays();

if (!collapsed || after.panelWidth > 0) {
  console.error(`FAIL: the panel did not collapse (width ${String(after.panelWidth)}), so nothing was tested`);
  await app.close();
  process.exit(1);
}

console.log("panel:", before.panelWidth, "->", after.panelWidth);
console.log("shell says:", after.text.slice(0, 110));

// The word can appear in a file tree or a tab; what has to survive is a line
// whose job is saying where you are.
const bar = await app.page.evaluate(() => {
  const el = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("app-context-bar");
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { height: Math.round(r.height), text: (el.shadowRoot?.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 80) };
});

if (bar === undefined || bar.height === 0) {
  console.error("FAIL: with the panel collapsed there is no line naming the machine, project or session");
  process.exitCode = 1;
} else if (!bar.text.toLowerCase().includes("pi-web")) {
  console.error(`FAIL: the line is there but does not name the project: ${bar.text}`);
  process.exitCode = 1;
} else console.log(`PASS: the shell still says where you are: ${bar.text}`);

await app.close();
