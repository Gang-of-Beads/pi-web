// Restart routes with an injected service: success (detached start) and
// failure paths without touching real systemd.
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createRestartService, detachedRestartRunners, registerRestartRoutes, type RestartService } from "./restartRoutes.js";

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

  // A container has no host service manager. Claiming a restart started there
  // told the caller work had begun that could never happen, and a fleet report
  // repeated that false claim for the machine.
  it("reports restart as unsupported inside a Docker deployment", async () => {
    const previous = process.env["PI_WEB_DOCKER_RUNTIME"];
    const previousSupervisor = process.env["PI_WEB_SUPERVISOR"];
    process.env["PI_WEB_DOCKER_RUNTIME"] = "1";
    delete process.env["PI_WEB_SUPERVISOR"];
    try {
      const service = createRestartService(undefined);
      expect(service.restartSupported()).toBe(false);
      await expect(service.restart()).rejects.toThrow(/unavailable inside a container/);
    } finally {
      if (previous === undefined) delete process.env["PI_WEB_DOCKER_RUNTIME"];
      else process.env["PI_WEB_DOCKER_RUNTIME"] = previous;
      if (previousSupervisor !== undefined) process.env["PI_WEB_SUPERVISOR"] = previousSupervisor;
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
// The version strip can find the session daemon stale while the page is current; reload cannot fix
// that, so it names the process it wants restarted.
describe("restarting one process", () => {
  it("passes a named process on, defaults to all, and refuses a word it does not know", async () => {
    const asked: (string | undefined)[] = [];
    app = Fastify({ logger: false });
    registerRestartRoutes(app, { restart: { restartSupported: () => true, restart: (target) => { asked.push(target); return Promise.resolve(); } } });
    await app.ready();

    const named = await app.inject({ method: "POST", url: "/api/pi-web/restart", payload: { process: "sessiond" } });
    const all = await app.inject({ method: "POST", url: "/api/pi-web/restart", payload: {} });
    const wrong = await app.inject({ method: "POST", url: "/api/pi-web/restart", payload: { process: "daemon" } });

    expect([named.statusCode, all.statusCode, wrong.statusCode]).toEqual([202, 202, 400]);
    expect(asked).toEqual(["sessiond", "all"]);
  });
});

describe("the command a restart runs", () => {
  it("names only the unit of the process asked for, and the session daemon first for both", async () => {
    const units = async (target: "all" | "web" | "sessiond"): Promise<readonly string[]> => (await detachedRestartRunners.systemd(target))[0]?.args.slice(7) ?? [];
    expect([await units("web"), await units("sessiond"), await units("all")]).toEqual([["pi-web.service"], ["pi-web-sessiond.service"], ["pi-web-sessiond.service", "pi-web.service"]]);
  });
});
