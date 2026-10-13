/**
 * Asking another PI WEB for this page's access, from the browser (docs/design/browser-direct-machines.md,
 * "Access is requested and approved"; owner, 2026-10-13: request, then approve it over there).
 *
 * The request goes straight to the machine: it is the one endpoint a machine answers for any page, and
 * the browser names this page's origin in it, which a page cannot forge. The machine answers an id and
 * a pairing code; the reader approves on the machine's own page, comparing the code, and this page
 * reads the request until it is decided. No cookies go along (`credentials: "omit"`): the machine's
 * answer to an unapproved page is the request and nothing else.
 */

export type PairingState = "pending" | "approved" | "denied";

export interface PairingRequest {
  readonly id: string;
  readonly code: string;
  readonly state: PairingState;
  readonly expiresAt: string;
}

/** Why asking failed, in words the reader can act on. */
export class PairingError extends Error {}

const REQUESTS_PATH = "api/machine-access/requests";

export async function requestAccess(baseUrl: string, name: string, request: typeof fetch = fetch): Promise<PairingRequest> {
  const response = await reach(baseUrl, () => request(machineUrl(baseUrl, REQUESTS_PATH), { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }));
  if (response.status === 404) throw new PairingError(`${hostOf(baseUrl)} runs a PI WEB without browser access. Update it, or choose This server.`);
  return parsePairing(await answered(response));
}

/** The request as the machine holds it now; undefined once the machine no longer knows it (expired). */
export async function readPairing(baseUrl: string, id: string, request: typeof fetch = fetch): Promise<PairingRequest | undefined> {
  const response = await reach(baseUrl, () => request(machineUrl(baseUrl, `${REQUESTS_PATH}/${encodeURIComponent(id)}`), { credentials: "omit" }));
  if (response.status === 404) return undefined;
  return parsePairing(await answered(response));
}

/** The machine's own page for this request: where the reader approves it. */
export function approvalUrl(baseUrl: string, id: string): string {
  const url = new URL(machineUrl(baseUrl, ""));
  url.searchParams.set("machine-access", id);
  return url.toString();
}

function machineUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

async function reach(baseUrl: string, send: () => Promise<Response>): Promise<Response> {
  try {
    return await send();
  } catch {
    throw new PairingError(`This browser cannot reach ${hostOf(baseUrl)}. Check the URL, or choose This server.`);
  }
}

async function answered(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch((): unknown => undefined);
  if (response.ok) return body;
  const words = isRecord(body) && typeof body["error"] === "string" ? body["error"] : `HTTP ${String(response.status)}`;
  throw new PairingError(words);
}

const STATES: Readonly<Record<PairingState, true>> = { pending: true, approved: true, denied: true };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPairingState(value: unknown): value is PairingState {
  return typeof value === "string" && Object.hasOwn(STATES, value);
}

function parsePairing(value: unknown): PairingRequest {
  if (!isRecord(value)) throw new PairingError("The machine answered without a request.");
  const { id, code, state, expiresAt } = value;
  if (typeof id !== "string" || typeof code !== "string" || typeof expiresAt !== "string" || !isPairingState(state)) {
    throw new PairingError("The machine answered with a request this page cannot read.");
  }
  return { id, code, state, expiresAt };
}
