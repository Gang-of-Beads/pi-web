// Self-update routes with an injected service, so the guards (disabled host,
// apply failure, apply start) are tested without touching real git.
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { PiWebSelfUpdateStatus } from "../../shared/apiTypes.js";
import { registerSelfUpdateRoutes, type SelfUpdateService } from "./selfUpdateRoutes.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function fakeService(status: PiWebSelfUpdateStatus, onApply: () => void | Promise<void>): SelfUpdateService {
  return {
    status: () => Promise.resolve(status),
    apply: () => Promise.resolve(onApply()),
  };
}

const DISABLED_STATUS: PiWebSelfUpdateStatus = {
  enabled: false,
  current: "",
  latest: undefined,
  available: false,
  branch: undefined,
  checkedAt: "2026-08-18T00:00:00.000Z",
  disabledReason: "no checkout",
};

describe("self-update routes", () => {
  it("reports disabled hosts so the UI never offers updates", async () => {
    app = Fastify({ logger: false });
    registerSelfUpdateRoutes(app, { selfUpdate: fakeService(DISABLED_STATUS, () => undefined) });
    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/pi-web/update/status" });
    expect(response.json()).toEqual({ enabled: false, current: "", latest: undefined, available: false, branch: undefined, checkedAt: DISABLED_STATUS.checkedAt, disabledReason: "no checkout" });
  });

  it("refuses to apply when the host has no checkout", async () => {
    app = Fastify({ logger: false });
    registerSelfUpdateRoutes(app, {
      selfUpdate: fakeService(DISABLED_STATUS, () => { throw new Error("no checkout to update"); }),
    });
    await app.ready();
    const response = await app.inject({ method: "POST", url: "/api/pi-web/update/apply", payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ started: false, error: "no checkout to update" });
  });

  it("acknowledges an apply that started detached", async () => {
    let applied = 0;
    app = Fastify({ logger: false });
    registerSelfUpdateRoutes(app, {
      selfUpdate: fakeService(DISABLED_STATUS, () => { applied += 1; }),
    });
    await app.ready();
    const response = await app.inject({ method: "POST", url: "/api/pi-web/update/apply", payload: {} });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ started: true });
    expect(applied).toBe(1);
  });
});