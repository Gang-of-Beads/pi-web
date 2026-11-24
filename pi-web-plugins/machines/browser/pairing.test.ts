import { describe, expect, it } from "vitest";
import { approvalUrl, PairingError, readPairing, requestAccess } from "./pairing";

const BASE = "https://machine.example:8504";
const TOKEN = "a/b+c=";
const PENDING = { id: "req1", code: "123456", state: "pending", expiresAt: "2026-11-24T00:10:00.000Z" };

/** A machine that answers once, and the requests it was sent. */
function machine(status: number, body: unknown): { request: typeof fetch; asked: { url: string; method: string }[] } {
  const asked: { url: string; method: string }[] = [];
  const request: typeof fetch = (input, init) => {
    asked.push({ url: input instanceof Request ? input.url : input.toString(), method: init?.method ?? "GET" });
    return Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  };
  return { request, asked };
}

const refusal = async (ask: Promise<unknown>): Promise<string> => ask.then(() => "answered", (error: unknown) => (error instanceof PairingError ? error.message : `not a PairingError: ${String(error)}`));

describe("asking a machine for this page's access", () => {
  it("asks at the machine's own path, with the token in front of it when the machine requires one", async () => {
    const open = machine(201, PENDING);
    const gated = machine(201, PENDING);
    await requestAccess({ baseUrl: BASE }, "page", undefined, open.request);
    await requestAccess({ baseUrl: `${BASE}/pi`, token: TOKEN }, "page", undefined, gated.request);
    expect([...open.asked, ...gated.asked]).toEqual([
      { url: `${BASE}/api/machine-access/requests`, method: "POST" },
      { url: `${BASE}/pi/access-token/a%2Fb%2Bc%3D/api/machine-access/requests`, method: "POST" },
    ]);
  });

  it("reads a waiting request, and a page the machine already approved", async () => {
    expect(await requestAccess({ baseUrl: BASE }, "page", undefined, machine(201, PENDING).request)).toEqual({ kind: "waiting", request: PENDING });
    expect(await requestAccess({ baseUrl: BASE }, "page", undefined, machine(200, { state: "approved" }).request)).toEqual({ kind: "approved" });
  });

  it("says what the reader can do about each refusal", async () => {
    const required = { error: "This PI WEB requires an access token.", code: "access-required" };
    expect({
      noToken: await refusal(requestAccess({ baseUrl: BASE }, "page", undefined, machine(401, required).request)),
      wrongToken: await refusal(requestAccess({ baseUrl: BASE, token: TOKEN }, "page", undefined, machine(401, required).request)),
      olderMachine: await refusal(requestAccess({ baseUrl: BASE, token: TOKEN }, "page", undefined, machine(401, "This PI WEB requires an access token.\n").request)),
      noSuchRoute: await refusal(requestAccess({ baseUrl: BASE }, "page", undefined, machine(404, { error: "Not found" }).request)),
      throttled: await refusal(requestAccess({ baseUrl: BASE, token: TOKEN }, "page", undefined, machine(429, { error: "Too many failed access attempts from this address; try again later.", code: "access-throttled" }).request)),
    }).toEqual({
      noToken: "machine.example:8504 requires an access token. Paste it below.",
      wrongToken: "machine.example:8504 requires an access token. The one below was not accepted.",
      olderMachine: "machine.example:8504 runs a PI WEB that cannot take an access token from a page. Update PI WEB there, or choose This server.",
      noSuchRoute: "machine.example:8504 does not answer browser access requests at this URL. Check the URL, update PI WEB there, or choose This server.",
      throttled: "Too many failed access attempts from this address; try again later.",
    });
  });

  it("polls the request with the token, and links to the machine's own page without it", async () => {
    const gated = machine(200, { ...PENDING, state: "approved" });
    expect(await readPairing({ baseUrl: BASE, token: TOKEN }, "req1", undefined, gated.request)).toEqual({ ...PENDING, state: "approved" });
    expect(await readPairing({ baseUrl: BASE }, "gone", undefined, machine(404, {}).request)).toBeUndefined();
    expect(gated.asked).toEqual([{ url: `${BASE}/access-token/a%2Fb%2Bc%3D/api/machine-access/requests/req1`, method: "GET" }]);
    expect(approvalUrl(BASE, "req1")).toBe(`${BASE}/?machine-access=req1`);
  });
});
