import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerMachineRoutes, type MachineRouteService } from "./machineRoutes.js";
import type { Machine } from "../../shared/apiTypes.js";

/**
 * The renaming route.
 *
 * Every other layer of this feature already existed: the store keeps a
 * `localAlias`, MachineService.update writes it and MachineService.list applies
 * it, the client has an `updateMachine` call, the controller wires it, and the
 * settings panel renders a rename form with a Save button. Only the HTTP route
 * was missing, so the button was always there and always failed - and the local
 * machine read "Local" on a fleet whose whole point is telling three boxes
 * apart. Service-level tests could not see it; this one talks to the router.
 */

/** Only the calls these two routes make; the rest is never reached. */
class StubMachineService implements Pick<MachineRouteService, "list" | "update"> {
  private readonly machines: Machine[] = [
    { id: "local", name: "Local", kind: "local", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" },
  ];

  list(): Promise<Machine[]> {
    return Promise.resolve(this.machines);
  }

  update(id: string, input: { name?: string }): Promise<Machine | undefined> {
    const machine = this.machines.find((candidate) => candidate.id === id);
    if (machine === undefined) return Promise.resolve(undefined);
    if (input.name !== undefined) machine.name = input.name;
    return Promise.resolve(machine);
  }
}

async function appWithRoutes() {
  const app = Fastify({ logger: false });
  const stub = new StubMachineService();
  // The routes under test use list and update only; the rest of the surface is
  // filled with throwers so an accidental call fails loudly instead of silently
  // returning undefined.
  const service: MachineRouteService = {
    list: () => stub.list(),
    update: (id, input) => stub.update(id, input),
    add: () => { throw new Error("not used"); },
    get: () => { throw new Error("not used"); },
    remove: () => { throw new Error("not used"); },
    health: () => { throw new Error("not used"); },
    runtime: () => { throw new Error("not used"); },
  };
  registerMachineRoutes(app, service);
  return app;
}

describe("machine routes", () => {
  it("renames the local machine and reports the new name", async () => {
    const app = await appWithRoutes();
    try {
      const response = await app.inject({ method: "PATCH", url: "/api/machines/local", payload: { name: "hxd-pc-ubuntu" } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: "local", name: "hxd-pc-ubuntu" });

      const listed = await app.inject({ method: "GET", url: "/api/machines" });
      expect(listed.json()).toMatchObject({ machines: [{ id: "local", name: "hxd-pc-ubuntu" }] });
    } finally {
      await app.close();
    }
  });

  it("404s a machine that does not exist", async () => {
    const app = await appWithRoutes();
    try {
      const response = await app.inject({ method: "PATCH", url: "/api/machines/nope", payload: { name: "x" } });

      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
