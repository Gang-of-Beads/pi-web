import { appendFile, mkdtemp, open, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPluginFile, type FileReply } from "./pluginFileReply.js";

interface Answer {
  status: number;
  readonly headers: Map<string, string>;
  payload: Buffer | Readable | undefined;
}

interface FileRequest {
  readonly method?: string;
  readonly range?: string;
  readonly ifRange?: string;
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fileHolding(contents: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-file-reply-"));
  roots.push(root);
  const path = join(root, "clip.mp4");
  await writeFile(path, contents);
  return path;
}

function fileReply(request: FileRequest = {}): { reply: FileReply; answer: Answer } {
  const answer: Answer = { status: 200, headers: new Map(), payload: undefined };
  const reply: FileReply = {
    request: { method: request.method ?? "GET", headers: { range: request.range, "if-range": request.ifRange } },
    sent: false,
    log: { warn: vi.fn() },
    code(status) { answer.status = status; },
    header(name, value) { answer.headers.set(name, value); },
    send(payload) { answer.payload = payload; },
  };
  return { reply, answer };
}

async function bodyText(answer: Answer): Promise<string> {
  const payload = answer.payload;
  if (payload === undefined) throw new Error("Nothing was sent");
  if (Buffer.isBuffer(payload)) return payload.toString("utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of payload) {
    if (!Buffer.isBuffer(chunk)) throw new Error("Expected binary chunks");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

describe("sendPluginFile", () => {
  it("answers a single byte range so a media element can seek", async () => {
    const path = await fileHolding("0123456789");
    const lastModified = (await stat(path)).mtime.toUTCString();
    const seeks: readonly { readonly request: FileRequest; readonly contentRange: string; readonly text: string }[] = [
      { request: { range: "bytes=0-3" }, contentRange: "bytes 0-3/10", text: "0123" },
      { request: { range: "bytes=6-" }, contentRange: "bytes 6-9/10", text: "6789" },
      { request: { range: "bytes=-2" }, contentRange: "bytes 8-9/10", text: "89" },
      { request: { range: "bytes=2-4", ifRange: lastModified }, contentRange: "bytes 2-4/10", text: "234" },
    ];
    for (const seek of seeks) {
      const { reply, answer } = fileReply(seek.request);
      await sendPluginFile(reply, await open(path, "r"));
      const text = await bodyText(answer);
      expect(answer.status).toBe(206);
      expect(answer.headers.get("Content-Range")).toBe(seek.contentRange);
      expect(answer.headers.get("Content-Length")).toBe(String(seek.text.length));
      expect(answer.headers.get("Last-Modified")).toBe(lastModified);
      expect(text).toBe(seek.text);
    }
  });

  it("serves the whole file when the range is absent, malformed, unsatisfiable, or for another version", async () => {
    const path = await fileHolding("0123456789");
    const requests: FileRequest[] = [
      {},
      { range: "" },
      { range: "bytes=" },
      { range: "bytes=abc-1" },
      { range: "bits=0-1" },
      { range: "bytes=99-120" },
      { range: "bytes=0-3,7-9" },
      { method: "POST", range: "bytes=0-3" },
      { range: "bytes=0-3", ifRange: "Sat, 01 Jan 2000 00:00:00 GMT" },
      { range: "bytes=0-3", ifRange: "\"an-entity-tag\"" },
    ];
    for (const request of requests) {
      const { reply, answer } = fileReply(request);
      await sendPluginFile(reply, await open(path, "r"));
      const text = await bodyText(answer);
      expect(answer.status).toBe(200);
      expect(answer.headers.get("Content-Range")).toBeUndefined();
      expect(answer.headers.get("Accept-Ranges")).toBe("bytes");
      expect(answer.headers.get("Content-Length")).toBe("10");
      expect(text).toBe("0123456789");
    }

    const empty = await open(await fileHolding(""), "r");
    const { reply, answer } = fileReply({ range: "bytes=0-3" });
    await sendPluginFile(reply, empty);
    const text = await bodyText(answer);
    expect(answer.headers.get("Content-Length")).toBe("0");
    expect(answer.status).toBe(200);
    expect(answer.headers.get("Content-Range")).toBeUndefined();
    expect(text).toBe("");
    expect(empty.fd).toBe(-1);
  });

  it.each([
    ["bytes=0-3", "bytes 0-3/10"],
    ["bytes=4-", "bytes 4-9/10"],
    ["  bytes=2-4  ", "bytes 2-4/10"],
    ["bytes=8-99", "bytes 8-9/10"],
    ["bytes=10-12", undefined],
    ["bytes=-0", undefined],
    ["bytes=0-0", "bytes 0-0/10"],
  ])("answers the range %s within a 10-byte file", async (range, contentRange) => {
    const { reply, answer } = fileReply({ range });
    await sendPluginFile(reply, await open(await fileHolding("0123456789"), "r"));
    await bodyText(answer);
    expect(answer.headers.get("Content-Range")).toBe(contentRange);
  });

  it("never streams more than the file held at the hand-over when it grows", async () => {
    const path = await fileHolding("12345");
    const file = await open(path, "r");
    const { reply, answer } = fileReply();

    await sendPluginFile(reply, file);
    await appendFile(path, "X".repeat(4096));
    const text = await bodyText(answer);

    expect(answer.headers.get("Content-Length")).toBe("5");
    expect(text).toBe("12345");
    await vi.waitFor(() => { expect(file.fd).toBe(-1); });
  });

  it("fails the answer instead of under-running the advertised size when the file shrinks", async () => {
    const largerThanOneReadBuffer = 1024 * 1024;
    const path = await fileHolding("x".repeat(largerThanOneReadBuffer));
    const file = await open(path, "r");
    const { reply, answer } = fileReply();

    await sendPluginFile(reply, file);
    await truncate(path, 1024);

    await expect(bodyText(answer)).rejects.toThrow("File changed while it was being read");
    expect(answer.headers.get("Content-Length")).toBe(String(largerThanOneReadBuffer));
    await vi.waitFor(() => { expect(file.fd).toBe(-1); });
  });
});
