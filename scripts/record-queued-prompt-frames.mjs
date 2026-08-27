/**
 * Record what the server actually sends a browser that queues a prompt while
 * the agent is streaming, so the duplicate-bubble report is reproduced from
 * real frames instead of a guess.
 *
 * The scenario: prompt A starts a long reply, prompt B is sent mid-stream with
 * a clientMessageId, and every event and status frame is written out.
 *
 * Usage: node scripts/record-queued-prompt-frames.mjs <cwd> [port]
 * Output: .pi/queued-prompt-frames.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import WebSocket from "ws";

const cwd = process.argv[2];
const port = process.argv[3] ?? "8505";
if (cwd === undefined) throw new Error("FAIL: a workspace cwd is required");

const base = `http://127.0.0.1:${port}/api`;
const post = async (path, body) => {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`FAIL: POST ${path} -> ${String(response.status)} ${await response.text()}`);
  return await response.json();
};

const started = await post("/sessions", { cwd });
const sessionId = started.id ?? started.sessionId;
if (typeof sessionId !== "string") throw new Error(`FAIL: no session id in ${JSON.stringify(started)}`);

const frames = [];
const socket = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/${encodeURIComponent(sessionId)}/events?cwd=${encodeURIComponent(cwd)}`);
socket.on("message", (raw) => { frames.push({ at: Date.now(), frame: JSON.parse(String(raw)) }); });
await new Promise((resolve, reject) => { socket.on("open", resolve); socket.on("error", reject); });

const clientMessageIdB = "cm-record-b";
await post(`/sessions/${sessionId}/prompt`, { cwd, text: "Count from 1 to 40, one number per line. Use no tools.", clientMessageId: "cm-record-a" });
let midStream;
for (let tick = 0; tick < 40; tick += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  midStream = await (await fetch(`${base}/sessions/${sessionId}/status?cwd=${encodeURIComponent(cwd)}`)).json();
  if (midStream.isStreaming === true) break;
}
if (midStream?.isStreaming !== true) throw new Error(`FAIL: prompt B would not be queued because prompt A never streamed: ${JSON.stringify(midStream)}`);
await post(`/sessions/${sessionId}/prompt`, { cwd, text: "Then say DONE.", streamingBehavior: "followUp", clientMessageId: clientMessageIdB });

// What a browser that reloads while the message is still queued would load:
// the transcript bubbles carry no client-side delivery mark, so the queue entry
// has to find its host in the server's own transcript or it draws a second row.
await new Promise((resolve) => setTimeout(resolve, 1500));
const reloadStatus = await (await fetch(`${base}/sessions/${sessionId}/status?cwd=${encodeURIComponent(cwd)}`)).json();
const reloadPage = await (await fetch(`${base}/sessions/${sessionId}/messages?cwd=${encodeURIComponent(cwd)}`)).json();
const reload = {
  queuedAtReload: reloadStatus.queuedMessages ?? [],
  userTexts: (reloadPage.messages ?? []).filter((message) => message.role === "user").map((message) => JSON.stringify(message.content ?? message.parts ?? "").slice(0, 80)),
};
if (reload.queuedAtReload.length === 0) throw new Error("FAIL: the reload snapshot was taken after the queue drained, so it proves nothing");
console.log(`reload snapshot: ${JSON.stringify(reload, null, 1)}`);

const statuses = [];
for (let tick = 0; tick < 60; tick += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const status = await (await fetch(`${base}/sessions/${sessionId}/status?cwd=${encodeURIComponent(cwd)}`)).json();
  statuses.push({ at: Date.now(), isStreaming: status.isStreaming, queuedMessages: status.queuedMessages });
  if (status.isStreaming === false && (status.queuedMessages ?? []).length === 0 && tick > 5) break;
}

socket.close();
mkdirSync(".pi", { recursive: true });
writeFileSync(".pi/queued-prompt-frames.json", JSON.stringify({ sessionId, clientMessageIdB, frames, statuses }, null, 2));

const appends = frames.filter((entry) => entry.frame.type === "message.append");
console.log(`sessionId=${sessionId}`);
console.log(`message.append frames: ${String(appends.length)}`);
for (const entry of appends) {
  const message = entry.frame.message ?? {};
  console.log(`  echo=${String(entry.frame.echo === true)} clientMessageId=${String(entry.frame.clientMessageId)} role=${String(message.role)} text=${JSON.stringify(String(JSON.stringify(message.content ?? message)).slice(0, 60))}`);
}
const queuedSeen = [...reload.queuedAtReload, ...statuses.flatMap((status) => status.queuedMessages ?? [])].map((message) => `${message.kind}:${message.text}:${String(message.clientMessageId)}`);
console.log(`queue snapshots: ${JSON.stringify([...new Set(queuedSeen)], null, 1)}`);
if (!queuedSeen.some((entry) => entry.endsWith(clientMessageIdB))) throw new Error("FAIL: prompt B was never observed in the queue carrying its id, so the queued path was not exercised");
