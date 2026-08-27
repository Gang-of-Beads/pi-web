/**
 * Live check that the system back gesture leaves a workspace view.
 *
 * The comparison deciding whether a popstate needs restoring ignored which
 * view was open, so four presses left the screen untouched while the address
 * bar said the files view. On Android that reads as a frozen app, and the next
 * press leaves it.
 *
 * Recorded before the fix: every back line reported main=chat-view. After it,
 * back returns to workspace-view.
 *
 * Usage: node scripts/verify-back-gesture.mjs
 */
import pw from '/Users/hanxiao.du/Desktop/vincent/projects/pi-web/node_modules/@playwright/test/index.js'; const { chromium } = pw;
const P='b8f74304-f20d-43a3-80a0-ad698f90ddd9', W='7a65a4a07e22', S='01a037f1-3fc4-714b-bc11-0b1f46117ea0';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:8505/?project=${P}&workspace=${W}&session=${S}`);
await page.waitForTimeout(3500);
const seen = [];
const st = async (t) => { const r = await page.evaluate(()=>({url:location.search.replace(/&?(project|workspace|session)=[^&]*/g,''), main:document.querySelector('pi-web-app').shadowRoot.querySelector('main').className, hist:history.length})); console.log(t, JSON.stringify(r)); };
async function tools(label){
  await page.evaluate(()=>{document.querySelector('pi-web-app').shadowRoot.querySelector('app-context-bar').shadowRoot.querySelector('button[title="Go to a view"]').click();});
  await page.waitForTimeout(400);
  await page.evaluate((l)=>{const s=document.querySelector('pi-web-app').shadowRoot.querySelector('app-mobile-tool-sheet');[...s.shadowRoot.querySelectorAll('button')].find(b=>b.textContent.includes(l)).click();}, label);
  await page.waitForTimeout(1200);
}
const history = async () => await page.evaluate(() => window.history.length);
await st('chat        ');
const atStart = await history();
await tools('Files');    await st('->files     ');
const afterOne = await history();
await tools('Terminal'); await st('->terminal  ');
await tools('Chat');     await st('->chat      ');

const views = [];
for (let i = 1; i <= 3; i += 1) {
  await page.goBack().catch(() => {});
  await page.waitForTimeout(900);
  await st(`back#${String(i)}      `).catch(() => {});
  views.push(await page.evaluate(() => new URLSearchParams(location.search).get("view") ?? ""));
}
await browser.close();

// One trip to a tool should leave one entry behind. Two entries per trip is
// what makes the back gesture look broken: the first press undoes a duplicate
// and appears to do nothing.
const cost = afterOne - atStart;
let failed = false;
if (cost !== 1) { console.error(`FAIL: opening one tool pushed ${cost} history entries, not 1`); failed = true; }

const distinct = views.filter((v, i) => i === 0 || v !== views[i - 1]).length;
// Three presses should undo three trips. When each trip left two entries, the
// first press of every pair appeared to do nothing.
if (distinct < 3) { console.error(`FAIL: three back presses only reached ${distinct} distinct views: ${JSON.stringify(views)}`); failed = true; }

if (failed) process.exitCode = 1; else console.log("PASS");

