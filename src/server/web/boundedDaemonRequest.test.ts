import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boundDaemonRequest, SESSION_PROXY_DEADLINE_MS } from "./boundedDaemonRequest";

afterEach(() => { vi.useRealTimers(); });

function connection(): EventEmitter & { writableFinished: boolean } {
  return Object.assign(new EventEmitter(), { writableFinished: false });
}

describe("a proxied daemon request always ends", () => {
  it("answers with the daemon's value and leaves its signal unaborted", async () => {
    const seen: AbortSignal[] = [];
    const outcome = await boundDaemonRequest(connection(), (signal) => {
      seen.push(signal);
      return Promise.resolve("answer");
    });
    expect({ outcome, aborted: seen[0]?.aborted }).toEqual({ outcome: { kind: "answered", value: "answer" }, aborted: false });
  });

  it("ends at the deadline and aborts the daemon call, even when the daemon ignores the signal", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const seen: AbortSignal[] = [];
    const pending = boundDaemonRequest(connection(), (signal) => {
      seen.push(signal);
      return new Promise<string>(() => undefined);
    });
    await vi.advanceTimersByTimeAsync(SESSION_PROXY_DEADLINE_MS);
    expect({ outcome: await pending, aborted: seen[0]?.aborted }).toEqual({ outcome: { kind: "deadline" }, aborted: true });
  });

  it("cancels the daemon call when the browser's connection goes away", async () => {
    const client = connection();
    const seen: AbortSignal[] = [];
    const pending = boundDaemonRequest(client, (signal) => {
      seen.push(signal);
      return new Promise<string>(() => undefined);
    });
    client.emit("close");
    expect({ outcome: await pending, aborted: seen[0]?.aborted }).toEqual({ outcome: { kind: "client-gone" }, aborted: true });
  });

  it("does not read a finished response's close as the browser leaving", async () => {
    const client = connection();
    let answer: (value: string) => void = () => undefined;
    const pending = boundDaemonRequest(client, () => new Promise<string>((resolve) => { answer = resolve; }));
    client.writableFinished = true;
    client.emit("close");
    answer("late but answered");
    expect(await pending).toEqual({ kind: "answered", value: "late but answered" });
  });

  it("passes a daemon failure through to the caller", async () => {
    await expect(boundDaemonRequest(connection(), () => Promise.reject(new Error("socket refused")))).rejects.toThrow("socket refused");
  });
});
