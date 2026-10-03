import { chromium } from "@playwright/test";

/**
 * A workspace link says where it lands (state-diagram D8), 8505, desktop 1440x900 and phone
 * 393x850.
 *
 * A link naming a project and workspace but no session opened the latest session on the desktop
 * while the URL kept naming only the workspace, so the URL did not describe the chat on screen. On
 * the phone it showed the Sessions board yet selected that session behind it, reading its whole
 * transcript (the 17.8 MB seed) for nobody. Now the desktop's URL names the session it opened, so
 * that address opens the same session in a browser that last opened another one there, and the
 * phone selects nothing and reads no transcript. No session is created and nothing is prompted.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const LINK = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}`;
const WORKSPACE_PATH = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace`;
const TRANSCRIPT_READ = /\/sessions\/[^/]+\/(messages|transcript-tail)$/u;
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};
const facts = (page) => page.evaluate(() => {
  const state = document.querySelector("pi-web-app")?.state;
  return { mainView: state?.mainView ?? null, selected: state?.selectedSession?.id ?? null };
});

const recordTranscriptReads = (context) => {
  const reads = [];
  context.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (TRANSCRIPT_READ.test(path)) reads.push(path);
  });
  return reads;
};
/** A browser tab that last opened `sessionId` in this workspace, as another reader's would have. */
const rememberingSession = async (context, sessionId) => {
  await context.addInitScript(([key, entry]) => {
    window.sessionStorage.setItem(key, JSON.stringify({ version: 1, entries: [entry] }));
  }, ["pi-web:session-selection:v1", [`local:${WORKSPACE_PATH}`, sessionId]]);
};

const browser = await chromium.launch();
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktop.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const desktopReads = recordTranscriptReads(desktop);
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(LINK);
  await desktopPage.waitForTimeout(7000);
  const opened = await facts(desktopPage);
  const named = new URL(desktopPage.url()).searchParams.get("session");
  check("precondition: on the desktop the workspace link opens a chat", opened.mainView === "chat" && opened.selected !== null, JSON.stringify(opened));
  check("control: opening a chat reads its transcript, so the phone's read check can see one", desktopReads.length > 0, `${String(desktopReads.length)} reads`);
  const listed = await (await fetch(`${BASE}/api/machines/local/sessions?cwd=${encodeURIComponent(WORKSPACE_PATH)}`)).json();
  const other = listed.find((session) => session.id !== opened.selected && session.archived !== true && session.cwdMissing !== true)?.id;
  check("precondition: the workspace lists another live session for the other tab to remember", typeof other === "string", `${String(listed.length)} listed`);
  check("the desktop URL names the session the link opened", named !== null && named === opened.selected, `URL session ${String(named)}, shown ${String(opened.selected)}`);
  const shared = desktopPage.url();
  await desktop.close();

  const elsewhere = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await elsewhere.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  await rememberingSession(elsewhere, other);
  const bareTab = await elsewhere.newPage();
  await bareTab.goto(LINK);
  await bareTab.waitForTimeout(7000);
  const bare = await facts(bareTab);
  check("control: in a tab that last opened another session, the bare workspace link opens that one", bare.selected === other, `${JSON.stringify(bare)}, remembered ${String(other)}`);
  await bareTab.close();
  const sharedTab = await elsewhere.newPage();
  await sharedTab.goto(shared);
  await sharedTab.waitForTimeout(7000);
  const landed = await facts(sharedTab);
  check("the address the desktop wrote opens the same session there", landed.selected === opened.selected, `${JSON.stringify(landed)} via ${new URL(shared).search}`);
  await elsewhere.close();

  const phone = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await phone.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const transcriptReads = recordTranscriptReads(phone);
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
