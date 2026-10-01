import { createServer } from "node:http";

/**
 * A deleted session is no longer pinned (owner, 2026-10-01: "删掉了自动就没有了啊，就是也不可能在pinned里面了"), 8505.
 *
 * The web process owns the pins and sees a deletion proven only in its daemon's answer to PI WEB's
 * own delete. A board locate answering gone is not proof: it starts from the home directory and
 * misses a project's own session directory (review of 4caabf4e), so a gone pin is kept and not drawn.
 * Legs:
 * - precondition: a session started for the probe is pinned, the deleted-id fixture (no store holds
 *   it) is pinned, and an existing session is pinned as the control;
 * - the board answers the fixture gone, and the machine still stores its pin;
 * - PI WEB archives and deletes the probe's session, and the machine no longer stores its pin;
 * - control: the existing pin is kept.
 * The fixture pin is removed at the end whatever happened; the existing pin is left as found. The
 * probe's session runs on the zero-cost fixture model, served here, never on the machine's default.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const DELETED_SESSION = "deadbeef-0000-7000-8000-000000000000";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};
const api = async (path, body) => {
  const response = await fetch(`${BASE}/api/machines/local${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
};
const pins = async () => (await api("/session-pins")).body?.pinnedSessionIds ?? [];
const pin = (sessionId, pinned) => api("/session-pins", { sessionId, pinned });

const server = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "flaky", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(chunk({ role: "assistant", content: "probe warm reply" }, null));
    response.write(chunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(18999, "127.0.0.1", resolve));

const existing = (await pins()).filter((id) => id !== DELETED_SESSION);
const created = await api("/sessions", { cwd: CWD });
const sessionId = created.body?.id;
try {
  const selected = await api(`/sessions/${String(sessionId)}/model`, { cwd: CWD, provider: "pi-web-probe", modelId: "flaky" });
  if (selected.body?.model?.provider !== "pi-web-probe") throw new Error(`the fixture model is not selectable: ${JSON.stringify(selected.body).slice(0, 200)}`);
  await api(`/sessions/${String(sessionId)}/prompt`, { cwd: CWD, text: "warm up" });
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  await pin(sessionId, true);
  await pin(DELETED_SESSION, true);
  const stored = await pins();
  check("precondition: the probe's session, the deleted-id fixture and an existing session are pinned", typeof sessionId === "string" && stored.includes(sessionId) && stored.includes(DELETED_SESSION) && existing.length > 0, JSON.stringify({ sessionId, stored, existing }));

  const board = await api("/session-board");
  const answer = (board.body?.pinned ?? []).find((entry) => entry.sessionId === DELETED_SESSION);
  const afterBoard = await pins();
  check("the board answers the fixture gone, and the machine still stores its pin", answer?.gone === true && afterBoard.includes(DELETED_SESSION), JSON.stringify({ answer, afterBoard }));

  const archived = await api("/sessions/bulk/archive", { sessions: [{ id: sessionId, cwd: CWD }] });
  const deleted = await api("/sessions/bulk/delete-archived", { sessions: [{ id: sessionId, cwd: CWD }] });
  const afterDelete = await pins();
  check("PI WEB deletes the probe's session, and the machine no longer stores its pin", deleted.status === 200 && (deleted.body?.deletedSessionIds ?? []).includes(sessionId) && !afterDelete.includes(sessionId), JSON.stringify({ archived: archived.status, deleted: deleted.body?.deletedSessionIds, afterDelete }));
  check("control: the existing pins are kept", existing.every((id) => afterDelete.includes(id)), JSON.stringify({ existing, afterDelete }));
} finally {
  await pin(DELETED_SESSION, false).catch(() => undefined);
  if (typeof sessionId === "string") await pin(sessionId, false).catch(() => undefined);
  server.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
