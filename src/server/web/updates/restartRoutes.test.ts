// Restart routes with an injected service: success (detached start) and
// failure paths without touching real systemd.
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createRestartService, registerRestartRoutes, type RestartService } from "./restartRoutes.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function fakeService(onRestart: () => void | Promise<void>): RestartService {
  return {
    restartSupported: () => true,
    restart: () => Promise.resolve(onRestart()),
  };
}

describe("restart routes", () => {
  it("starts a detached restart and replies 202", async () => {
    let restarted = false;
    app = Fastify({ logger: false });
    registerRestartRoutes(app, { restart: fakeService(() => { restarted = true; }) });
    await app.ready();
    const response = await app.inject({ method: "POST", url: "/api/pi-web/restart", payload: {} });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ started: true });
    expect(restarted).toBe(true);
  });

  // A container has no systemd user session. Claiming a restart started there
  // told the caller work had begun that could never happen, and a fleet report
  // repeated that false claim for the machine.
  it("reports restart as unsupported inside a Docker deployment", async () => {
    const previous = process.env["PI_WEB_DOCKER_RUNTIME"];
    process.env["PI_WEB_DOCKER_RUNTIME"] = "1";
    try {
      const service = createRestartService(undefined);
      expect(service.restartSupported()).toBe(false);
      await expect(service.restart()).rejects.toThrow(/unavailable on this host/);
    } finally {
      if (previous === undefined) delete process.env["PI_WEB_DOCKER_RUNTIME"];
      else process.env["PI_WEB_DOCKER_RUNTIME"] = previous;
    }
  });

  it("reports restart failures as 400 without starting", async () => {
    app = Fastify({ logger: false });
    registerRestartRoutes(app, {
      restart: {
        restartSupported: () => true,
        restart: () => Promise.reject(new Error("no systemd user session")),
      },
    });
    await app.ready();
    const response = await app.inject({ method: "POST", url: "/api/pi-web/restart", payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ started: false, error: "no systemd user session" });
  });
});