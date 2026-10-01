import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionPinStore } from "../shared/storage/sessionPinStore.js";
import { registerSessionPinRoutes } from "./sessionPinRoutes.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function pinApp() {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-pins-"));
  const app = Fastify();
  const changed = vi.fn();
  registerSessionPinRoutes(app, new SessionPinStore(join(dir, "session-pins.json"), changed), "/api");
  cleanups.push(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  return { app, changed };
}

describe("the pin routes say when the pins changed (P5 slice a)", () => {
  it("announces each pin, unpin and adopt that changed the set, and nothing for a read, a refused change, or a write that changed nothing", async () => {
    const { app, changed } = await pinApp();
    const post = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/session-pins", payload: body });

    await app.inject({ method: "GET", url: "/api/session-pins" });
    const afterRead = changed.mock.calls.length;
    const pinned = await post({ sessionId: "s1", pinned: true });
    const afterPin = changed.mock.calls.length;
    const refused = await post({ sessionId: "", pinned: true });
    const afterRefusal = changed.mock.calls.length;
    await post({ sessionId: "s1", pinned: true });
    const afterRepeat = changed.mock.calls.length;
    await post({ sessionId: "s1", pinned: false });
    await post({ adopt: ["s2"] });
    await post({ adopt: ["s2"] });
    await post({ sessionId: "s9", pinned: false });

    expect({ afterRead, pinned: pinned.statusCode, afterPin, refused: refused.statusCode, afterRefusal, afterRepeat, total: changed.mock.calls.length }).toEqual({
      afterRead: 0,
      pinned: 200,
      afterPin: 1,
      refused: 400,
      afterRefusal: 1,
      afterRepeat: 1,
      total: 3,
    });
  });
});
