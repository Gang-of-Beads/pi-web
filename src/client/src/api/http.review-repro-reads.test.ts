// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/consistent-type-assertions -- review repro fixture: stubs reach into private runtime shapes; rewritten as a permanent test when its phase removes it.fails */
import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./http.js";
import { resetInFlight } from "./inFlight.js";
import { REQUEST_TIMEOUT_MS } from "./requestDeadline.js";

/**
 * Every read a panel renders has to settle, because an unsettled read leaves
 * whatever the panel set while waiting on screen for the life of the page.
 * Measured live on the 8505 stack: the subagents panel stayed on "Reading this
 * session's subagents…" for 47s while the server had sent 200 headers at once,
 * and the 30s request deadline never fired.
 *
 * Root cause: the deadline's timer is cleared as soon as the response headers
 * arrive (`finally { deadline.done(); }` at api/http.ts), and the body read
 * that follows is then untimed. The same shape exists in fetchWithDeadline,
 * whose callers (plugin backends, the manifest, terminal command runs) all read
 * the body after it has already returned.
 */

/** A fetch whose headers arrive at once and whose body never finishes. */
function stallingFetch(): typeof fetch {
  return ((_url: string | URL, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const abort = (): void => { controller.error(new DOMException("aborted", "AbortError")); };
        if (init?.signal?.aborted === true) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      },
    });
    return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
  }) as typeof fetch;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); resetInFlight(); });

describe("a read whose body stalls", () => {
  it("settles at the deadline instead of waiting for the body forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", stallingFetch());
    let settled: string | undefined;
    void request("api/plugins/subagents/runs.list", (value) => value).then(
      () => { settled = "answered"; },
      (error: unknown) => { settled = error instanceof Error ? error.name : String(error); },
    );
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1000);
    expect(settled).toBeDefined();
  });

  /**
   * A stalled read is not retried: the in-flight entry is only dropped when it
   * settles, so every later read of the same url joins the zombie.
   */
  it("pins a later read of the same url to the stalled one instead of retrying", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ known: true }), { status: 200, headers: { "content-type": "application/json" } })));
    let first = true;
    vi.stubGlobal("fetch", ((url: string, init?: RequestInit) => {
      if (!first) return fetchMock();
      first = false;
      const body = new ReadableStream<Uint8Array>({ start() { void init; } });
      return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
    }));
    let settled: string | undefined;
    void request("api/machines/local/sessions/unread", (value) => value).then(() => { settled = "answered"; });
    await vi.advanceTimersByTimeAsync(10);
    void request("api/machines/local/sessions/unread", (value) => value).then(() => { settled = "answered"; });
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(settled).toBeUndefined();
  });

  it("still parses a body that does arrive", async () => {
    vi.stubGlobal("fetch", (() => Promise.resolve(new Response(JSON.stringify({ known: true }), { status: 200, headers: { "content-type": "application/json" } }))));
    await expect(request("api/plugins/subagents/runs.list", (value) => value)).resolves.toEqual({ known: true });
  });
});
