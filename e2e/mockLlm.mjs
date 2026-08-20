#!/usr/bin/env node
/**
 * Minimal OpenAI-compatible streaming endpoint for end-to-end tests.
 *
 * Delivery-state tests need a turn that is *slow on purpose*: the whole point
 * is what the UI shows while the agent is mid-turn and a second message has to
 * queue behind it. A real provider cannot be asked to stall for a fixed number
 * of seconds, and a stub inside the client would not exercise the server's
 * queue projection at all, so the container runs this instead.
 *
 *   node e2e/mockLlm.mjs [--port=18999] [--chunks=40] [--delay=250]
 *
 * Each request streams `chunks` text deltas `delay` ms apart, so a turn lasts
 * roughly chunks*delay ms. A prompt containing FASTMOCK answers in one chunk,
 * so a test that only needs a session to exist on disk does not pay for a slow
 * turn it never looks at.
 */
import { createServer } from "node:http";

const arg = (name, fallback) => {
  const found = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return found === undefined ? fallback : Number(found.slice(name.length + 3));
};

const port = arg("port", 18999);
const chunks = arg("chunks", 40);
const delay = arg("delay", 250);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url?.startsWith("/health")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, chunks, delay }));
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(404).end();
    return;
  }

  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    void streamCompletion(request, response, body);
  });
});

async function streamCompletion(request, response, body) {
  const fast = request.url?.includes("fast=1") === true || body.includes("FASTMOCK");
  const total = fast ? 1 : chunks;
  const gap = fast ? 0 : delay;
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-mock-${String(created)}`;
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const send = (payload) => { response.write(`data: ${JSON.stringify(payload)}\n\n`); };
  send({ id, object: "chat.completion.chunk", created, model: "mock-model", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  for (let index = 0; index < total; index++) {
    if (response.writableEnded) return;
    send({ id, object: "chat.completion.chunk", created, model: "mock-model", choices: [{ index: 0, delta: { content: `chunk ${String(index + 1)} ` }, finish_reason: null }] });
    if (gap > 0) await sleep(gap);
  }
  send({ id, object: "chat.completion.chunk", created, model: "mock-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  response.write("data: [DONE]\n\n");
  response.end();
  // Keep a trace of what the agent actually sent; useful when a queued steer is
  // expected to arrive in the *next* request rather than the current one.
  process.stdout.write(`${new Date().toISOString()} completion (${String(body.length)} bytes) streamed ${String(total)} chunks\n`);
}

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`mock llm listening on 127.0.0.1:${String(port)} (chunks=${String(chunks)} delay=${String(delay)}ms)\n`);
});
