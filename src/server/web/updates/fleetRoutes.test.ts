import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine, PiWebFleetReport, PiWebFleetRunResponse } from "../../../shared/apiTypes.js";
import { registerFleetRoutes, type FleetMachines } from "./fleetRoutes.js";

/**
 * Fleet fan-out.
 *
 * The behaviour that matters is not "did it call restart" but "does the answer
 * say who it covered": the operation used to mean a different set of machines
 * depending on which session the caller had selected, and the only cure is a
 * report that names the hub and every target.
 */

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /api/pi-web/fleet", () => {
  it("reports the hub and every machine it knows, with versions", async () => {
    app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/api/pi-web/fleet" });

    expect(response.statusCode).toBe(200);
    const body = response.json<PiWebFleetReport>();
    expect(body.hub).toEqual({ machineId: "local", name: "This machine" });
    expect(body.machines).toEqual([
      { machineId: "local", name: "This machine", kind: "local", online: true, version: "1.2.3" },
      { machineId: "remote-a", name: "hxd-pi", kind: "remote", online: true, version: "1.2.0" },
    ]);
  });

  it("marks an unreachable machine offline instead of failing the report", async () => {
    app = await buildApp({ remoteHealthy: false });

    const body = (await app.inject({ method: "GET", url: "/api/pi-web/fleet" })).json<PiWebFleetReport>();

    expect(body.machines[1]).toMatchObject({ machineId: "remote-a", online: false, error: "unreachable" });
  });
});

describe("POST /api/pi-web/fleet/run", () => {
  it("restarts every known machine and names them in the outcome", async () => {
    const restart = vi.fn(() => Promise.resolve());
    app = await buildApp({ restart });

    const response = await app.inject({ method: "POST", url: "/api/pi-web/fleet/run", payload: { operation: "restart" } });

    expect(response.statusCode).toBe(200);
    const body = response.json<PiWebFleetRunResponse>();
    expect(body.operation).toBe("restart");
    expect(body.hub.name).toBe("This machine");
    expect(body.outcomes).toEqual([
      { machineId: "local", name: "This machine", started: true },
      { machineId: "remote-a", name: "hxd-pi", started: true },
    ]);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("targets a subset by id or by name", async () => {
    app = await buildApp();

    const body = (await app.inject({ method: "POST", url: "/api/pi-web/fleet/run", payload: { operation: "update", machineIds: ["hxd-pi"] } }))
      .json<PiWebFleetRunResponse>();

    expect(body.outcomes).toEqual([{ machineId: "remote-a", name: "hxd-pi", started: true }]);
  });

  it("reports a failed target next to the ones that started", async () => {
    app = await buildApp({ remoteStatus: 503 });

    const body = (await app.inject({ method: "POST", url: "/api/pi-web/fleet/run", payload: { operation: "restart" } }))
      .json<PiWebFleetRunResponse>();

    expect(body.outcomes[0]).toMatchObject({ machineId: "local", started: true });
    expect(body.outcomes[1]).toMatchObject({ machineId: "remote-a", started: false, error: "restart responded 503" });
  });

  it("keeps going when one machine throws", async () => {
    app = await buildApp({ remoteThrows: "connection refused" });

    const body = (await app.inject({ method: "POST", url: "/api/pi-web/fleet/run", payload: { operation: "restart" } }))
      .json<PiWebFleetRunResponse>();

    expect(body.outcomes[0]?.started).toBe(true);
    expect(body.outcomes[1]).toMatchObject({ started: false, error: "connection refused" });
  });

  it("rejects an unknown operation and an unmatched target", async () => {
    app = await buildApp();

    expect((await app.inject({ method: "POST", url: "/api/pi-web/fleet/run", payload: { operation: "reboot" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/pi-web/fleet/run", payload: { operation: "restart", machineIds: ["nope"] } })).statusCode).toBe(404);
  });

  it("says plainly when the hub itself cannot restart", async () => {
    app = await buildApp({ withRestartService: false });

    const body = (await app.inject({ method: "POST", url: "/api/pi-web/fleet/run", payload: { operation: "restart", machineIds: ["local"] } }))
      .json<PiWebFleetRunResponse>();

    expect(body.outcomes[0]).toMatchObject({ started: false, error: "Restart is unavailable on this host" });
  });
});

interface Options {
  restart?: () => Promise<void>;
  withRestartService?: boolean;
  remoteHealthy?: boolean;
  remoteStatus?: number;
  remoteThrows?: string;
}

async function buildApp(options: Options = {}): Promise<FastifyInstance> {
  const instance = Fastify();
  const machines = fakeMachineService(options);
  registerFleetRoutes(instance, {
    machines,
    ...(options.withRestartService === false ? {} : { restart: { restartSupported: () => true, restart: options.restart ?? (() => Promise.resolve()) } }),
    selfUpdate: { status: () => Promise.reject(new Error("unused")), apply: () => Promise.resolve() },
  });
  await instance.ready();
  return instance;
}

/** Minimal stand-in for the registry slice the routes declare they need. */
function fakeMachineService(options: Options): FleetMachines {
  const machines: Machine[] = [
    { id: "local", name: "This machine", kind: "local" as const, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
    { id: "remote-a", name: "hxd-pi", kind: "remote" as const, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
  ];
  const local = machines[0];
  if (local === undefined) throw new Error("fixture must have a local machine");
  return {
    list: () => Promise.resolve(machines),
    localMachine: () => Promise.resolve(local),
    health: (id: string) => Promise.resolve(id === "local" || options.remoteHealthy !== false
      ? { machineId: id, ok: true, checkedAt: "2026-08-20T00:00:00.000Z" }
      : { machineId: id, ok: false, checkedAt: "2026-08-20T00:00:00.000Z", error: "unreachable" }),
    runtime: (id: string) => Promise.resolve({
      machineId: id,
      ok: true,
      checkedAt: "2026-08-20T00:00:00.000Z",
      components: {
        web: { component: "web" as const, label: "Web", available: true, capabilities: [], runtimeVersion: id === "local" ? "1.2.3" : "1.2.0" },
        sessiond: { component: "sessiond" as const, label: "Session daemon", available: true, capabilities: [] },
      },
    }),
    remoteClient: () => Promise.resolve({
      request: () => {
        if (options.remoteThrows !== undefined) return Promise.reject(new Error(options.remoteThrows));
        return Promise.resolve({ statusCode: options.remoteStatus ?? 202 });
      },
    }),
  };
}
