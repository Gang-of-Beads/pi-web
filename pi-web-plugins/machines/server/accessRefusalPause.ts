import { PassThrough, Readable } from "node:stream";
import type { WebSocket } from "ws";
import type { MachineClient, MachineHttpResponse, MachineJsonResponse, MachineRequestOptions } from "@gang-of-beads/pi-web/server-plugin-api";
import { DEFAULT_REMOTE_REQUEST_TIMEOUT_MS, RemoteMachineRequestError } from "@gang-of-beads/pi-web/server-plugin-api";

/**
 * A remote PI WEB's access gate refusing the token this server holds for it, and the pause that
 * follows (live check 2026-10-21: the gateway's own health, runtime and fleet reads used up the
 * remote's 20-failure allowance for this server's address within about 3 s, which then refused the
 * right-token entries too, for 10 minutes).
 *
 * After one refusal this server stops contacting that machine. Every request through its client is
 * answered at once with the refusal it got. The pause lasts 10 minutes, or as long as a throttling
 * remote's `Retry-After` says (at most 10 minutes). It ends sooner when the machine's entry is edited
 * (a new token) or the reader explicitly asks again ("Refresh selected machine"); an automatic check,
 * such as the Machines list's, never ends it. Each end starts a new generation, and a refusal answered
 * to a request sent in an earlier generation (with the old token, say) is ignored. The codes are the
 * remote gate's own, read from its JSON answer; any other 401 or 429 (an authenticating proxy) is not
 * a refusal.
 */

export type AccessRefusal = "token-refused" | "throttled";

const ACCESS_REFUSAL_PAUSE_MS = 10 * 60 * 1000;
const MIN_RETRY_AFTER_MS = 1000;
const REFUSAL_BODY_LIMIT_BYTES = 64 * 1024;

const REFUSAL_BY_ANSWER: ReadonlyMap<string, AccessRefusal> = new Map([
  ["401 access-required", "token-refused"],
  ["429 access-throttled", "throttled"],
]);

const REFUSAL_ANSWER: Readonly<Record<AccessRefusal, { readonly statusCode: number; readonly body: { readonly error: string; readonly code: string } }>> = {
  "token-refused": { statusCode: 401, body: { error: "This PI WEB requires an access token.", code: "access-required" } },
  throttled: { statusCode: 429, body: { error: "Too many failed access attempts from this address; try again later.", code: "access-throttled" } },
};

/** The words a machine card and the gateway's socket closes use for a refusal. */
export const ACCESS_REFUSAL_WORDS: Readonly<Record<AccessRefusal, string>> = {
  "token-refused": "This server's access token was refused",
  throttled: "This server's access token attempts are refused for now",
};

/** The card's words for a pause with `remainingMs` left. */
export function accessRefusalPauseWords(remainingMs: number): string {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `This server stops contacting it for ${String(minutes)} ${minutes === 1 ? "minute" : "minutes"}, or until its token is changed or you refresh it.`;
}

export function accessRefusal(statusCode: number, body: unknown): AccessRefusal | undefined {
  const code = typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" ? body.code : "";
  return REFUSAL_BY_ANSWER.get(`${String(statusCode)} ${code}`);
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function couldBeRefusal(statusCode: number, headers: Record<string, string | string[] | undefined>): boolean {
  const json = headerValue(headers, "content-type")?.toLowerCase().includes("json") === true;
  return json && (statusCode === 401 || statusCode === 429);
}

/** How long a refusal pauses: a throttling remote's `Retry-After` in seconds, kept within 1 s and 10 minutes. */
function pauseMs(refusal: AccessRefusal, headers: Record<string, string | string[] | undefined>): number {
  const retryAfter = Number(headerValue(headers, "retry-after"));
  if (refusal !== "throttled" || !Number.isFinite(retryAfter) || retryAfter <= 0) return ACCESS_REFUSAL_PAUSE_MS;
  return Math.min(ACCESS_REFUSAL_PAUSE_MS, Math.max(MIN_RETRY_AFTER_MS, retryAfter * 1000));
}

/** The machines this server has stopped contacting, and why. Owned by `MachineService`. */
export class AccessRefusalPauses {
  private readonly paused = new Map<string, { readonly until: number; readonly refusal: AccessRefusal }>();
  private readonly generations = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  active(machineId: string): AccessRefusal | undefined {
    const pause = this.paused.get(machineId);
    if (pause === undefined) return undefined;
    if (pause.until > this.now()) return pause.refusal;
    this.paused.delete(machineId);
    return undefined;
  }

  /** How long the machine's pause has left; 0 when there is none. */
  remainingMs(machineId: string): number {
    const pause = this.paused.get(machineId);
    return pause === undefined ? 0 : Math.max(0, pause.until - this.now());
  }

  /** The generation a request is sent in; a refusal is recorded only while it is still current. */
  generation(machineId: string): number {
    return this.generations.get(machineId) ?? 0;
  }

  record(machineId: string, generation: number, refusal: AccessRefusal, durationMs: number): void {
    if (generation !== this.generation(machineId)) return;
    this.paused.set(machineId, { until: this.now() + durationMs, refusal });
  }

  /** An edit or an explicit refresh: the pause ends, and refusals to requests sent before it no longer count. */
  clear(machineId: string): void {
    this.paused.delete(machineId);
    this.generations.set(machineId, this.generation(machineId) + 1);
  }
}

function destroyReadable(body: NodeJS.ReadableStream): void {
  const destroy: unknown = Reflect.get(body, "destroy");
  if (typeof destroy === "function") Reflect.apply(destroy, body, []);
}

/**
 * The bytes already read followed by the rest of `upstream`, as one stream that owns `upstream` until
 * it ends: when the replay is destroyed (the client went away, the reply closed) the upstream is
 * destroyed at once rather than after its next chunk, and an upstream error destroys the replay. The
 * replay keeps its own error listener: a replay nobody consumes (a socket's refused upgrade, read only
 * for its code) must not turn the upstream's error into an uncaught one.
 */
function replayStream(prefix: Buffer, upstream: NodeJS.ReadableStream): Readable {
  const replay = new PassThrough();
  let ended = false;
  upstream.once("end", () => { ended = true; });
  upstream.on("error", (error: unknown) => { replay.destroy(error instanceof Error ? error : new Error(String(error))); });
  replay.on("error", () => { if (!ended) destroyReadable(upstream); });
  replay.once("close", () => { if (!ended) destroyReadable(upstream); });
  replay.write(prefix);
  upstream.pipe(replay);
  return replay;
}

/**
 * Reads a possible refusal's JSON body, at most `REFUSAL_BODY_LIMIT_BYTES`, within the request's
 * remaining deadline and until its caller cancels: the peek runs after the remote client has handed
 * the body over, so neither the client's own timer nor its cancellation covers it. A deadline or
 * cancellation destroys the remote's stream and rejects as the remote client would. A body past the
 * limit is not a refusal: it is handed back as the bytes read followed by the rest, unchanged.
 */
function peekBody(body: NodeJS.ReadableStream, remainingMs: number, signal: AbortSignal | undefined): Promise<{ parsed: unknown; replay: Readable }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    const timer = setTimeout(() => { fail(new RemoteMachineRequestError("Remote machine response body timed out", 504)); }, Math.max(1, remainingMs));
    timer.unref();
    const onAbort = (): void => { fail(new RemoteMachineRequestError("Remote machine request cancelled", 502)); };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      body.removeListener("data", onData);
      body.removeListener("end", onEnd);
      body.removeListener("error", onError);
    };
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      cleanup();
      return true;
    };
    const fail = (error: Error): void => {
      if (!settle()) return;
      destroyReadable(body);
      reject(error);
    };
    const onData = (chunk: unknown): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      chunks.push(buffer);
      length += buffer.byteLength;
      if (length <= REFUSAL_BODY_LIMIT_BYTES || !settle()) return;
      body.pause();
      resolve({ parsed: undefined, replay: replayStream(Buffer.concat(chunks), body) });
    };
    const onEnd = (): void => {
      if (!settle()) return;
      const read = Buffer.concat(chunks);
      resolve({ parsed: parseJson(read), replay: Readable.from([read]) });
    };
    const onError = (error: unknown): void => { fail(new RemoteMachineRequestError(error instanceof Error ? error.message : String(error), 502)); };
    body.on("data", onData);
    body.once("end", onEnd);
    body.once("error", onError);
    if (signal?.aborted === true) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseJson(body: Buffer): unknown {
  try {
    const value: unknown = JSON.parse(body.toString("utf8"));
    return value;
  } catch {
    return undefined;
  }
}

function requestOptions(args: Parameters<MachineClient["request"]>): MachineRequestOptions {
  return args[3] ?? {};
}

/** The machine's client, answering for it while it is paused and pausing it when its gate refuses. */
export function pausingMachineClient(client: MachineClient, machineId: string, pauses: AccessRefusalPauses, generation: number): MachineClient {
  return {
    async request(...args: Parameters<MachineClient["request"]>): Promise<MachineHttpResponse> {
      const paused = pauses.active(machineId);
      if (paused !== undefined) {
        const answer = REFUSAL_ANSWER[paused];
        return { statusCode: answer.statusCode, headers: { "content-type": "application/json" }, body: Readable.from([JSON.stringify(answer.body)]) };
      }
      const startedAt = Date.now();
      const response = await client.request(...args);
      if (response.body === undefined || !couldBeRefusal(response.statusCode, response.headers)) return response;
      const options = requestOptions(args);
      const remainingMs = (options.timeoutMs ?? DEFAULT_REMOTE_REQUEST_TIMEOUT_MS) - (Date.now() - startedAt);
      const { parsed, replay } = await peekBody(response.body, remainingMs, options.signal);
      const refusal = accessRefusal(response.statusCode, parsed);
      if (refusal !== undefined) pauses.record(machineId, generation, refusal, pauseMs(refusal, response.headers));
      return { ...response, body: replay };
    },
    async requestJson(...args: Parameters<MachineClient["requestJson"]>): Promise<MachineJsonResponse> {
      const paused = pauses.active(machineId);
      if (paused !== undefined) {
        const answer = REFUSAL_ANSWER[paused];
        return { statusCode: answer.statusCode, headers: { "content-type": "application/json" }, body: answer.body };
      }
      const response = await client.requestJson(...args);
      const refusal = accessRefusal(response.statusCode, response.body);
      if (refusal !== undefined) pauses.record(machineId, generation, refusal, pauseMs(refusal, response.headers));
      return response;
    },
    connectWebSocket(path: string): WebSocket {
      const paused = pauses.active(machineId);
      if (paused !== undefined) throw new RemoteMachineRequestError(ACCESS_REFUSAL_WORDS[paused], 502);
      const socket = client.connectWebSocket(path);
      socket.once("unexpected-response", (_request, response) => {
        if (!couldBeRefusal(response.statusCode ?? 0, response.headers)) return;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => { chunks.push(chunk); });
        response.once("end", () => {
          const refusal = accessRefusal(response.statusCode ?? 0, parseJson(Buffer.concat(chunks)));
          if (refusal !== undefined) pauses.record(machineId, generation, refusal, pauseMs(refusal, response.headers));
        });
      });
      return socket;
    },
  };
}
