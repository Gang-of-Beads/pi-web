export const PROBE_BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
export const PROBE_PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
export const PROBE_WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
export const PROBE_SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";
export const PROBE_CWD = process.env.PI_WEB_PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";

/**
 * Open the app on the seeded conversation.
 *
 * The app boots to the navigation board when the URL names nothing, so a probe
 * that then looks for a transcript finds an empty page. Naming the project,
 * workspace and session in the URL is the same boot a share link uses.
 */
export async function openProbedSession(page, base = PROBE_BASE) {
  await page.goto(
    `${base}/?project=${PROBE_PROJECT}&workspace=${PROBE_WORKSPACE}&session=${PROBE_SESSION}&view=chat`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForTimeout(3000);
}
