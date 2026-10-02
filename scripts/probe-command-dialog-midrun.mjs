/**
 * A dialog an extension command opens while a run is going outlives that run (B54,
 * state-diagram D2: "Run end and Stop settle only what the run opened"), 8505.
 *
 * Found 2026-10-02: `/ui-custom-probe` typed while a warm-up run was still retrying opened its
 * screen, and the run's end settled it less than a second later; the command's `ctx.ui.custom`
 * returned undefined before anyone could answer. The probe drives the daemon through the web API
 * only: a run against the zero-cost `pi-web-probe/flaky` model (nothing serves it, so pi retries
 * for a while), the command typed during it, then the run ends. Archives its session.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};
const post = (path, body) => fetch(`${BASE}/api/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, ...body }) }).then((response) => response.json());
const status = (sessionId) => fetch(`${BASE}/api/sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`).then((response) => response.json()).catch(() => ({}));
const screens = (state) => (state.pendingDialogs ?? []).filter((dialog) => dialog.kind === "custom");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let sessionId;
try {
  sessionId = (await post("sessions", {})).id;
  console.log("session:", sessionId);
  const selected = await post(`sessions/${sessionId}/model`, { provider: "pi-web-probe", modelId: "flaky" });
  if (selected?.model?.provider !== "pi-web-probe") throw new Error("the zero-cost fixture model is not selectable; this probe never prompts a real model");

  await post(`sessions/${sessionId}/prompt`, { text: "say ok" });
  let running = false;
  for (let waited = 0; waited < 20_000 && !running; waited += 250) {
    running = (await status(sessionId)).isStreaming === true;
    if (!running) await sleep(250);
  }
  check("precondition: a run is going", running);

  await post(`sessions/${sessionId}/prompt`, { text: "/ui-custom-probe" });
  let opened;
  let openedWhileRunning = false;
  for (let waited = 0; waited < 30_000 && opened === undefined; waited += 250) {
    const state = await status(sessionId);
    opened = screens(state)[0];
    openedWhileRunning = state.isStreaming === true;
    if (opened === undefined) await sleep(250);
  }
  check("precondition: the command opened its screen while the run was still going", opened !== undefined && openedWhileRunning, opened === undefined ? "never opened" : `runScoped ${String(opened.runScoped)}`);

  let ended = false;
  for (let waited = 0; waited < 120_000 && !ended; waited += 500) {
    ended = (await status(sessionId)).isStreaming === false;
    if (!ended) await sleep(500);
  }
  check("precondition: the run ended", ended);
  await sleep(3000);
  const after = screens(await status(sessionId));
  check("the command's screen is still open after the run ended", opened !== undefined && after.some((dialog) => dialog.dialogId === opened.dialogId), `${String(after.length)} open`);
  if (opened !== undefined) await post(`sessions/${sessionId}/dialogs/cancel`, { dialogId: opened.dialogId });
} finally {
  if (sessionId !== undefined) await post(`sessions/${sessionId}/archive`, {}).catch(() => undefined);
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
