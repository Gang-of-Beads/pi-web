/**
 * Live check that every composer control fits on screen, including while the
 * agent is answering, when the stop button joins the row.
 *
 * Usage: node scripts/verify-composer-row-fits.mjs [port]
 */
import { chromium } from "@playwright/test";

const port = process.argv[2] ?? "8505";
const P = "b8f74304-f20d-43a3-80a0-ad698f90ddd9";
const W = "7a65a4a07e22";
const S = "01a037f1-3fc4-714b-bc11-0b1f46117ea0";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
let failed = false;

for (const width of [320, 360, 393]) {
  const ctx = await b.newContext({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${port}/?project=${P}&workspace=${W}&session=${S}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(3000);

  // The stop button only exists while a turn is running, which is exactly when
  // the row is fullest. Drive that state rather than measuring the idle row.
  const driven = await p.evaluate(() => {
    const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor");
    if (!editor) return false;
    editor.isStreaming = true;
    editor.canStop = true;
    editor.requestUpdate();
    return true;
  });
  if (!driven) { console.error(`FAIL: ${width}px - no composer, so nothing was measured`); failed = true; await ctx.close(); continue; }
  await p.waitForTimeout(500);

  const row = await p.evaluate(() => {
    const editor = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot;
    const actions = editor?.querySelector(".actions");
    if (!actions) return undefined;
    const controls = [...actions.querySelectorAll("button")].map((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // Fitting on screen is not the same as being visible: a control can be
      // laid out correctly and still be transparent, hidden, or unusable.
      return {
        name: (el.getAttribute("aria-label") ?? el.className).slice(0, 18),
        onScreen: r.width > 0 && r.left >= -1 && r.right <= window.innerWidth + 1,
        visible: style.visibility !== "hidden" && Number(style.opacity) > 0.2 && style.display !== "none",
        enabled: !el.disabled,
      };
    });
    // Overlap is what the reader sees, and it is not the same as overflow: a
    // row can report no overflow while its controls sit on top of each other.
    const boxes = [...actions.querySelectorAll("button")].map((el) => el.getBoundingClientRect());
    const collisions = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const c = boxes[j];
        const across = Math.min(a.right, c.right) - Math.max(a.left, c.left);
        const down = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        if (across > 1 && down > 1) collisions.push(`${String(i)}x${String(j)}:${String(Math.round(across))}px`);
      }
    }
    const footer = actions.closest("footer");
    const room = footer === null ? null : Math.round(footer.getBoundingClientRect().right - actions.getBoundingClientRect().right);
    return { overflow: Math.round(actions.scrollWidth - actions.clientWidth), collisions, room, controls };
  });

  if (row === undefined) { console.error(`FAIL: ${width}px - no control row`); failed = true; await ctx.close(); continue; }
  const offScreen = row.controls.filter((control) => !control.onScreen || !control.visible).map((control) => control.name);
  const send = row.controls.find((control) => control.name.toLowerCase().includes("send") || control.name.toLowerCase().includes("steer"));
  console.log(`${width}px  控件=${row.controls.length}  溢出=${row.overflow}  看不见=${offScreen.length === 0 ? "无" : JSON.stringify(offScreen)}  发送键=${send === undefined ? "缺失" : `可见${String(send.visible)}/可用${String(send.enabled)}`}`);
  if (send === undefined || !send.visible) { console.error(`  FAIL: no usable send control at ${width}px while the agent is answering`); failed = true; }
  if (row.collisions.length > 0) { console.error(`  FAIL: controls overlap each other: ${row.collisions.join(", ")}`); failed = true; }
  if (row.room !== null && row.room < 0) { console.error(`  FAIL: the row runs ${String(-row.room)}px past the composer`); failed = true; }
  if (row.controls.length < 4) { console.error(`  FAIL: only ${row.controls.length} controls rendered, so the full row was not measured`); failed = true; }
  if (row.overflow > 0 || offScreen.length > 0) { console.error(`  FAIL: the row does not fit at ${width}px`); failed = true; }
  await ctx.close();
}

await b.close();
if (failed) process.exitCode = 1; else console.log("PASS");
