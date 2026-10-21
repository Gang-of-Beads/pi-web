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

/** Why asking the machine failed; the message is shown to the reader as is. */
export class PairingError extends Error {}

const REQUESTS_PATH = "api/machine-access/requests";

/**
 * What asking for access came to: a request waiting for approval, or a page the machine has already
 * approved, which it answers with no request at all - the dialog then adds the machine straight away.
 */
export type AccessAnswer = { readonly kind: "waiting"; readonly request: PairingRequest } | { readonly kind: "approved" };

/**
 * How long one ask or one poll waits for the machine. A machine that never answers - a firewall
 * dropping the connection on the way there - otherwise kept the dialog on "Asking…" for good.
 */
const MACHINE_ANSWER_DEADLINE_MS = 15_000;

/**
 * `pageName` labels this page on the machine's approval page; the machine trusts only the Origin the browser sets.
 * `cancelled` is the reader leaving the dialog: the request is dropped and its abort passes through as it came.
 */
export async function requestAccess(baseUrl: string, pageName: string, cancelled?: AbortSignal, request: typeof fetch = fetch): Promise<AccessAnswer> {
  const answer = await reach(baseUrl, cancelled, (signal) => request(machineUrl(baseUrl, REQUESTS_PATH), { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: pageName }), signal }));
  if (answer.status === 404) throw new PairingError(`${hostOf(baseUrl)} does not answer browser access requests at this URL. Check the URL, update PI WEB there, or choose This server.`);
  if (requiresAccessToken(answer)) throw new PairingError(`${hostOf(baseUrl)} requires an access token. Choose This server and paste the token.`);
  const body = answered(answer);
  return isAlreadyApproved(body) ? { kind: "approved" } : { kind: "waiting", request: parsePairing(body) };
}

/**
 * A machine whose access gate is on refuses every page, approved or not: a browser cannot carry its
 * token to another origin. Only This server can reach it (docs/machines.md).
 */
function requiresAccessToken(answer: MachineAnswer): boolean {
  return answer.status === 401 && isRecord(answer.body) && answer.body["code"] === "access-required";
}

function isAlreadyApproved(body: unknown): boolean {
  return isRecord(body) && body["state"] === "approved" && body["id"] === undefined;
}

/** The request as the machine holds it now; undefined when the machine no longer knows it (restarted, already decided, or removed). */
export async function readPairing(baseUrl: string, id: string, cancelled?: AbortSignal, request: typeof fetch = fetch): Promise<PairingRequest | undefined> {
  const answer = await reach(baseUrl, cancelled, (signal) => request(machineUrl(baseUrl, `${REQUESTS_PATH}/${encodeURIComponent(id)}`), { credentials: "omit", signal }));
  if (answer.status === 404) return undefined;
  return parsePairing(answered(answer));
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

/** What the machine answered, body included: the deadline holds until the body is read, not just the headers. */
interface MachineAnswer {
  readonly status: number;
  readonly ok: boolean;
  readonly body: unknown;
}

/**
 * The machine's answer, abandoned after MACHINE_ANSWER_DEADLINE_MS or when the dialog cancels. One
 * controller carries both, with a timer, because AbortSignal.any and AbortSignal.timeout are missing
 * on the iOS Home Screen app before 17.4.
 */
async function reach(baseUrl: string, cancelled: AbortSignal | undefined, send: (signal: AbortSignal) => Promise<Response>): Promise<MachineAnswer> {
  const controller = new AbortController();
  const signal = controller.signal;
  const timer = setTimeout(() => { controller.abort(); }, MACHINE_ANSWER_DEADLINE_MS);
  const cancel = (): void => { controller.abort(); };
  cancelled?.addEventListener("abort", cancel, { once: true });
  if (cancelled?.aborted === true) controller.abort();
  try {
    const response = await send(signal);
    const body: unknown = await response.json().catch((error: unknown) => {
      if (signal.aborted) throw error;
      return undefined;
    });
    return { status: response.status, ok: response.ok, body };
  } catch (error) {
    if (cancelled?.aborted === true) throw error;
    throw new PairingError(`This browser cannot reach ${hostOf(baseUrl)}. Check the URL, or choose This server.`);
  } finally {
    clearTimeout(timer);
    cancelled?.removeEventListener("abort", cancel);
  }
}

function answered(answer: MachineAnswer): unknown {
  if (answer.ok) return answer.body;
  const words = isRecord(answer.body) && typeof answer.body["error"] === "string" ? answer.body["error"] : `HTTP ${String(answer.status)}`;
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
