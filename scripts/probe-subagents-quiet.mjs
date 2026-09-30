import { chromium } from "@playwright/test";

/**
 * P3 slice b on the 8505 stack, phone 393x850 coarse: the subagents panel reads its runs while
 * watched and working, is quiet while idle, asks nothing while the chat is open, and reads once
 * when the reader comes back after the session's work settled out of sight. A shell command is
 * the work here: it makes the session active and then idle, which is the host's settled edge,
 * and it costs no model call. The control runs the same excursion with no work in it.
 */
const BASE = "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const SESSION = "01a0f231-7591-717d-a5dd-db04f6f5d05a";
const TOOL = "subagents:workspace.subagents";

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  const runReads = [];
  page.on("request", (request) => {
    if (/\/plugin-operations\/[^?]*runs\.list|runs\.list/u.test(request.url())) runReads.push(Date.now());
  });
  const readsSince = (at) => runReads.filter((time) => time >= at).length;
  const app = () => page.evaluate(() => {
    const element = document.querySelector("pi-web-app");
    const state = element?.state;
    return { mainView: state?.mainView, session: state?.selectedSession?.id, cwd: state?.selectedSession?.cwd, streaming: state?.status?.isStreaming, bash: state?.status?.isBashRunning, activity: state?.activity?.phase };
  });
  const showView = (view) => page.evaluate((next) => { document.querySelector("pi-web-app")?.showView(next); }, view);

  const loadStart = Date.now();
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&tool=${encodeURIComponent(TOOL)}&view=${encodeURIComponent(TOOL)}`);
  await page.waitForTimeout(8_000);
  const loaded = await app();
  check("precondition: the subagents panel of the live session is on screen", loaded.mainView === TOOL && loaded.session === SESSION, JSON.stringify(loaded));
  check("precondition: the panel read the runs on open", readsSince(loadStart) >= 1, `reads=${String(readsSince(loadStart))}`);
  check("precondition: the session is idle", loaded.streaming === false && loaded.bash === false, JSON.stringify(loaded));

  const idleStart = Date.now();
  await page.waitForTimeout(30_000);
  check("an idle session's panel asks nothing for 30 s", readsSince(idleStart) === 0, `reads=${String(readsSince(idleStart))}`);

  const excursion = async (label, work) => {
    await showView("chat");
    await page.waitForTimeout(1_000);
    const inChat = await app();
    check(`${label}: precondition, the chat is on screen`, inChat.mainView === "chat", JSON.stringify(inChat));
    const chatStart = Date.now();
    let sawWork = false;
    if (work) {
      const accepted = await page.evaluate(async ({ id, cwd }) => {
        const response = await fetch(`api/sessions/${encodeURIComponent(id)}/shell`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd, text: "!!sleep 3" }) });
        return response.status;
      }, { id: SESSION, cwd: inChat.cwd });
      check(`${label}: precondition, the daemon accepted the shell command`, accepted >= 200 && accepted < 300, `status=${String(accepted)}`);
      for (let index = 0; index < 20; index += 1) {
        await page.waitForTimeout(250);
        const now = await app();
        if (now.bash === true || now.activity === "active") sawWork = true;
      }
      check(`${label}: precondition, the page saw the session work`, sawWork, "");
    }
    await page.waitForTimeout(15_000);
    const settled = await app();
    check(`${label}: precondition, the session is idle again`, settled.bash === false && settled.streaming === false, JSON.stringify(settled));
    check(`${label}: the chat asks nothing about runs`, readsSince(chatStart) === 0, `reads=${String(readsSince(chatStart))}`);
    const back = Date.now();
    await showView(TOOL);
    await page.waitForTimeout(3_000);
    const returned = readsSince(back);
    await page.waitForTimeout(20_000);
    return { returned, after: readsSince(back) - returned };
  };

  const control = await excursion("control, no work", false);
  check("control: coming back with nothing settled asks nothing", control.returned === 0 && control.after === 0, JSON.stringify(control));
  const worked = await excursion("work out of sight", true);
  check("work out of sight: coming back reads the runs once, then goes quiet", worked.returned === 1 && worked.after === 0, JSON.stringify(worked));
  await page.screenshot({ path: "/var/folders/2x/hqbz74zs7fvdxf_53693r26h0000gp/T/.playwright-mcp/p3b-subagents-panel-phone.png" });
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
