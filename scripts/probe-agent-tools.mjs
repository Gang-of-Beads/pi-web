import { createServer } from "node:http";

/**
 * PI WEB gives the agent no tools of its own, and delegation works as routes.
 *
 * Owner, 2026-09-30: "pi web不要给ai任何多余工具都应该由用户自己插件定义". This probe
 * serves the `pi-web-probe/flaky` model that the 8505-only fixture extension
 * registers (~/.pi/agent/extensions/ui-custom-probe.ts), so it sees exactly the tool
 * list a real session sends to the model. It then drives the delegation routes
 * against the real daemon: start a tracked child, list it, check it, read it, and
 * start an independent session.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const RETIRED = ["spawn_session", "spawn_subsession", "list_subsessions", "check_subsession", "read_subsession", "yield_to_subsessions"];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

const toolLists = [];
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    try { toolLists.push((JSON.parse(body).tools ?? []).map((tool) => tool.function?.name ?? tool.name)); } catch { toolLists.push(["(unparsed)"]); }
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    response.write(chunk({ role: "assistant", content: "child done" }, null));
    response.write(chunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(18999, "127.0.0.1", resolve));

const api = async (path, init) => {
  const response = await fetch(`${BASE}/api/${path}`, { headers: { "content-type": "application/json" }, ...init });
  return { status: response.status, body: await response.json().catch(() => undefined) };
};
const waitIdle = async (sessionId) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(1000);
    const { body } = await api(`sessions/${sessionId}/status?cwd=${encodeURIComponent(CWD)}`);
    if (body?.isStreaming !== true) return;
  }
  throw new Error(`session ${sessionId} never went idle`);
};

try {
  const parent = (await api("sessions", { method: "POST", body: JSON.stringify({ cwd: CWD }) })).body?.id;
  if (typeof parent !== "string") throw new Error("no session was created");
  const selected = await api(`sessions/${parent}/model`, { method: "POST", body: JSON.stringify({ cwd: CWD, provider: "pi-web-probe", modelId: "flaky" }) });
  if (selected.body?.model?.provider !== "pi-web-probe") throw new Error("the probe model is not selectable (is the fixture loaded?)");
  await api(`sessions/${parent}/prompt`, { method: "POST", body: JSON.stringify({ cwd: CWD, text: "hello" }) });
  await waitIdle(parent);

  // The first request is often the session-name call, which carries no tools; the
  // turn's own request does.
  const tools = [...new Set(toolLists.flat())];
  leg("precondition: the model saw the turn's tool list", tools.includes("read") && tools.includes("edit"), JSON.stringify(tools));
  const retiredSeen = tools.filter((name) => RETIRED.includes(name));
  leg("the agent is offered none of the retired delegation tools", retiredSeen.length === 0, JSON.stringify(retiredSeen));

  const child = await api(`sessions/${parent}/subsessions`, { method: "POST", body: JSON.stringify({ cwd: CWD, prompt: "say done" }) });
  leg("the subsession route starts a tracked child", child.status === 200 && typeof child.body?.sessionId === "string", JSON.stringify(child));
  const childId = child.body?.sessionId;
  await waitIdle(childId);
  const listed = await api(`sessions/${parent}/subsessions?cwd=${encodeURIComponent(CWD)}`);
  leg("the child is listed under its parent", (listed.body?.subsessions ?? []).some((entry) => entry.sessionId === childId), JSON.stringify(listed.body?.subsessions));
  const checked = await api(`sessions/${parent}/subsessions/${childId}?cwd=${encodeURIComponent(CWD)}`);
  leg("checking the child returns its last reply", checked.body?.finalText === "child done", JSON.stringify(checked.body));
  const read = await api(`sessions/${parent}/subsessions/${childId}/transcript?cwd=${encodeURIComponent(CWD)}&roles=assistant`);
  leg("reading the child's transcript returns its reply", JSON.stringify(read.body?.entries ?? []).includes("child done"), `status ${String(read.status)}`);
  const stranger = await api(`sessions/${parent}/subsessions/${parent}?cwd=${encodeURIComponent(CWD)}`);
  leg("a session that is not its child is refused", stranger.status === 400, `status ${String(stranger.status)}`);

  const independent = await api(`sessions/${parent}/spawn`, { method: "POST", body: JSON.stringify({ cwd: CWD, prompt: "say done" }) });
  leg("the spawn route starts an independent session", independent.status === 200 && typeof independent.body?.sessionId === "string" && independent.body.sessionId !== childId, JSON.stringify(independent));
} finally {
  server.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `ALL ${results.length} LEGS PASS` : `${failed} of ${results.length} LEGS FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
