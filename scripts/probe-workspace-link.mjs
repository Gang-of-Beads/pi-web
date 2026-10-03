import { chromium } from "@playwright/test";

/**
 * A workspace link says where it lands (state-diagram D8), 8505, desktop 1440x900 and phone
 * 393x850.
 *
 * A link naming a project and workspace but no session opened the latest session on the desktop
 * while the URL kept naming only the workspace, so the URL did not describe the chat on screen. On
 * the phone it showed the Sessions board yet selected that session behind it, reading its whole
 * transcript (the 17.8 MB seed) for nobody. Now the desktop's URL names the session it opened, and
 * the phone selects nothing and reads no transcript. No session is created and nothing is prompted.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const LINK = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}`;
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};
const facts = (page) => page.evaluate(() => {
  const state = document.querySelector("pi-web-app")?.state;
  return { mainView: state?.mainView ?? null, selected: state?.selectedSession?.id ?? null };
});

const browser = await chromium.launch();
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktop.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(LINK);
  await desktopPage.waitForTimeout(7000);
  const opened = await facts(desktopPage);
  const named = new URL(desktopPage.url()).searchParams.get("session");
  check("precondition: on the desktop the workspace link opens a chat", opened.mainView === "chat" && opened.selected !== null, JSON.stringify(opened));
  check("the desktop URL names the session the link opened", named !== null && named === opened.selected, `URL session ${String(named)}, shown ${String(opened.selected)}`);
  await desktopPage.reload();
  await desktopPage.waitForTimeout(7000);
  check("a reload shows the same session", (await facts(desktopPage)).selected === opened.selected, JSON.stringify(await facts(desktopPage)));
  await desktop.close();

  const phone = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await phone.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const transcriptReads = [];
  phone.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/sessions\/[^/]+\/(messages|transcript-tail)$/u.test(path)) transcriptReads.push(path);
  });
  const phonePage = await phone.newPage();
  await phonePage.goto(LINK);
  await phonePage.waitForTimeout(7000);
  const board = await facts(phonePage);
  check("precondition: on the phone the workspace link shows the Sessions board", board.mainView === "navigation", JSON.stringify(board));
  check("the phone selects no session behind the board", board.selected === null, JSON.stringify(board));
  check("and reads no transcript for it", transcriptReads.length === 0, transcriptReads.join(", "));
  await phonePage.screenshot({ path: "/tmp/surfaces/workspace-link-phone.png" });
  await phone.close();
} finally {
  await browser.close();
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
