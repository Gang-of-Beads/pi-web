import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { RealtimeEvent } from "../../../shared/apiTypes.js";
import { CHANGE_NUDGE_PATH } from "../../shared/sessiondClient/changeNudge.js";
import { registerChangeNudgeRoutes } from "./changeNudgeRoutes.js";

const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

describe("a web writer's change nudge (P5 slice a)", () => {
  it("publishes pins.changed for the pins kind, and refuses a kind it does not know without publishing", async () => {
    const app = Fastify();
    apps.push(app);
    const published: RealtimeEvent[] = [];
    registerChangeNudgeRoutes(app, { publishRealtime: (event) => { published.push(event); } });

    const pins = await app.inject({ method: "POST", url: CHANGE_NUDGE_PATH, payload: { kind: "pins" } });
    const unknown = await app.inject({ method: "POST", url: CHANGE_NUDGE_PATH, payload: { kind: "nope" } });

    expect({ pins: pins.statusCode, unknown: unknown.statusCode, published }).toEqual({ pins: 200, unknown: 400, published: [{ type: "pins.changed" }] });
  });
});
