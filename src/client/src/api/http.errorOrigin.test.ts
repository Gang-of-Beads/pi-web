// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, request } from "./http.js";
import { resetInFlight } from "./inFlight.js";

afterEach(() => { vi.unstubAllGlobals(); resetInFlight(); });

function answering(status: number, body: string, contentType = "application/json"): void {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(body, { status, headers: { "content-type": contentType } })));
}

async function failure(url: string): Promise<HttpError> {
  try {
    await request(url, (value) => value);
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error("the read answered");
}

/**
 * Review 6088e664 / 98e437b2: only PI WEB's gateway can say a remote machine
 * did not answer - it names the machine in its body. A proxy in front of PI WEB
 * (Vite during a dev reload, nginx) answering 502 for a remote machine's URL
 * says nothing about that machine, and the app row must not blame it.
 */
describe("who answered a failed read", () => {
  it("marks an error the gateway answered for a machine it names", async () => {
    answering(502, JSON.stringify({ error: "Remote machine unavailable", machineId: "ubuntu", detail: "connect ECONNREFUSED" }));
    const error = await failure("api/machines/ubuntu/projects");
    expect({ status: error.status, machineId: error.machineId, answeredBy: error.answeredBy }).toEqual({ status: 502, machineId: "ubuntu", answeredBy: "gateway" });
  });

  it("does not mark a proxy's bare 502 on a remote machine's URL as the gateway's", async () => {
    answering(502, "", "text/plain");
    const error = await failure("api/machines/ubuntu/projects");
    expect({ status: error.status, machineId: error.machineId, answeredBy: error.answeredBy }).toEqual({ status: 502, machineId: "ubuntu", answeredBy: undefined });
  });
});
