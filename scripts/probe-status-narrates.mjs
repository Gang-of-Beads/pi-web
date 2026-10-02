import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * The status line narrates the agent's step (B25, state-diagram D3), 8505, phone 393x850.
 *
 * The owner saw "message queued · 10m 51s" stand while the agent worked and two queued messages
 * waited with no reason given (2026-09-30). This probe serves the `pi-web-probe/flaky` model that
 * ~/.pi/agent/extensions/ui-custom-probe.ts registers on 8505: its reply to the probe's prompt
 * runs `bash sleep`, every other reply is plain text. No real model is prompted.
 *
 * - step: while the sleep runs, the dock says "Running bash: sleep N" with the step's time.
 * - queued: after a second message is sent during the sleep, the dock still names the step and
 *   says when that message is read, never the event word "message queued".
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const PROJECT = "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = "ef2cdf93e1ac";
const SLEEP_SECONDS = 25;
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};

const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (part) => { body += part; });
  request.on("end", () => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (body.includes("probe-narrate") && !body.includes("call_sleep")) {
      response.write(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_sleep", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: `sleep ${String(SLEEP_SECONDS)}` }) } }] }, null));
      response.write(chunk({}, "tool_calls"));
    } else {
      response.write(chunk({ role: "assistant", content: "probe done" }, null));
      response.write(chunk({}, "stop"));
    }
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(18999, "127.0.0.1", resolve));

const api = (path, body) => fetch(`${BASE}/api/${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD, ...body }) }).then((response) => response.json());
const dockText = (page) => page.evaluate(() => {
  const find = (root) => {
    const hit = root.querySelector(".activity-dock .activity-text");
    if (hit !== null) return hit;
    for (const node of root.querySelectorAll("*")) {
      if (node.shadowRoot === null) continue;
      const inner = find(node.shadowRoot);
      if (inner !== null) return inner;
    }
    return null;
  };
  return find(document)?.textContent?.trim() ?? "";
});
const browser = await chromium.launch();
let sessionId;
try {
  sessionId = (await api("sessions", {})).id;
  console.log("session:", sessionId);
  const selected = await api(`sessions/${sessionId}/model`, { provider: "pi-web-probe", modelId: "flaky" });
  if (selected?.model?.provider !== "pi-web-probe") throw new Error("the zero-cost fixture model is not selectable; this probe never prompts a real model");
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await api(`sessions/${sessionId}/prompt`, { text: "probe-narrate: run a long command" });
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${sessionId}&view=chat`);

  let step = "";
  for (let waited = 0; waited < 20_000 && !step.startsWith("Running bash"); waited += 250) {
    step = await dockText(page);
    if (!step.startsWith("Running bash")) await page.waitForTimeout(250);
  }
  check("step: the dock names the command that runs, with the step's time", /^Running bash: sleep \d+ · \d+ s/u.test(step), JSON.stringify(step));

  await api(`sessions/${sessionId}/prompt`, { text: "and one more thing", clientMessageId: `narrate-${String(Date.now())}` });
  let queued = "";
  for (let waited = 0; waited < 8000 && !queued.includes("message"); waited += 250) {
    queued = await dockText(page);
    if (!queued.includes("message")) await page.waitForTimeout(250);
  }
  check("queued: the dock keeps the step and says when the message is read", /^Running bash: sleep \d+ · \d+ s · 1 message is read when these tools finish$/u.test(queued), JSON.stringify(queued));
  check("queued: the dock never parrots the event word", !queued.includes("message queued"), JSON.stringify(queued));
  await page.screenshot({ path: "/tmp/surfaces/status-narrates-phone.png" });
  await context.close();
} finally {
  await browser.close();
  server.close();
  if (sessionId !== undefined) {
    await api(`sessions/${sessionId}/abort`, {}).catch(() => undefined);
    await api(`sessions/${sessionId}/archive`, {}).catch(() => undefined);
  }
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
