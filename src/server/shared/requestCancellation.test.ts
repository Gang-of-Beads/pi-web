import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestCancellation } from "./requestCancellation.js";

// These tests deliberately use a listening server instead of `app.inject`,
// because the false-positive cancellation they guard against comes from real
// Node request/response stream lifecycles that the injection harness fakes.
let app: FastifyInstance;
let baseUrl: string;

beforeEach(() => {
  app = Fastify({ logger: false });
});

afterEach(async () => {
  await app.close();
});

async function listen(): Promise<void> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
}

describe("requestCancellation", () => {
  it("stays live for a body-bearing request whose handler already awaited other work", async () => {
    app.delete("/resource", async (request, reply) => {
      // Mirrors routes that resolve a project before starting the cancellable
      // operation: by now Node has auto-destroyed the fully read request body.
      await new Promise((resolve) => { setImmediate(resolve); });
      const cancellation = requestCancellation(request, reply);
      try {
        return { abortedBeforeStart: cancellation.signal.aborted };
      } finally {
        cancellation.dispose();
      }
    });
    await listen();

    const response = await fetch(`${baseUrl}/resource`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ precondition: "v1.confirmed" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ abortedBeforeStart: false });
  });

  it("aborts when the client disconnects while the handler is still working", async () => {
    let abortReason = "";
    // The disconnect must happen while the handler is mid-flight, and the only
    // party that knows it has reached that point is the handler itself. An
    // earlier version guessed with a 20ms timer, which raced the request's
    // arrival: when the machine was loaded enough for the socket to take
    // longer than that, the abort fired before there was a request to cancel,
    // the handler then waited on a signal nobody would ever trip, and the case
    // died on vitest's 5s wall - measured twice in full-suite runs at 5039ms
    // and 5091ms while passing in 24ms on an idle machine.
    let announceHandlerReached!: () => void;
    const handlerReached = new Promise<void>((resolve) => { announceHandlerReached = resolve; });
    const observed = new Promise<void>((resolveObserved) => {
      app.delete("/resource", async (request, reply) => {
        const cancellation = requestCancellation(request, reply);
        try {
          await new Promise<void>((resolveAbort) => {
            cancellation.signal.addEventListener("abort", () => {
              abortReason = cancellation.signal.reason instanceof Error ? cancellation.signal.reason.message : "";
              resolveAbort();
            }, { once: true });
            announceHandlerReached();
          });
          resolveObserved();
          return {};
        } finally {
          cancellation.dispose();
        }
      });
    });
    await listen();

    const controller = new AbortController();
    const pending = fetch(`${baseUrl}/resource`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ precondition: "v1.confirmed" }),
      signal: controller.signal,
    });
    await handlerReached;
    controller.abort();
    await expect(pending).rejects.toThrow();

    await observed;
    expect(abortReason).toBe("HTTP request cancelled");
  });
});
