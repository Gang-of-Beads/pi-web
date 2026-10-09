import { isRecord } from "../../../shared/unknownValues";
import { resolveAppUrl } from "../appUrl";
import { machineIdFromUrl, reportTransportReachable } from "./transportHealth";
import { deadlineSignal, fetchNamingLinkFailure, RequestTimeoutError, timeoutForBody } from "./requestDeadline";
import type { TransportClaim } from "./transportClaim";
import { dedupeKey, shareInFlight } from "./inFlight";
import { watchedFetch } from "./ackWatch";
import { ROUTE_MISSING_CODE, TRANSPORT_FAILURES, type TransportFailure } from "../../../shared/apiTypes";

/**
 * Who answered with the error, when it is known. Only PI WEB's gateway names
 * the machine it failed for in its body; a proxy in front of PI WEB answering
 * for a remote machine's URL says nothing about that machine.
 */
export type HttpErrorOrigin = "gateway";

export class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly machineId?: string, readonly answeredBy?: HttpErrorOrigin, readonly code?: string, readonly transport?: TransportClaim) {
    super(message);
    this.name = "HttpError";
  }
}

export async function request<T>(url: string, parse: (value: unknown) => T, init?: RequestInit): Promise<T> {
  // Reads for the same url share one round trip while it is unsettled; each
  // caller then parses the same body with its own parser. Writes never share:
  // two sends that look identical are two messages, and what makes a repeat
  // safe lives in the daemon's operation ledger, not in a client-side map. A
  // caller that brought its own abort signal keeps its own request, because
  // sharing would let one caller's cancellation settle another's read.
  const shareKey = init?.signal === undefined || init.signal === null ? dedupeKey(url, init?.method) : undefined;
  const body = await shareInFlight(shareKey, () => fetchBody(url, init));
  return parse(body);
}

/**
 * One request, bounded end to end: the deadline covers the body as well as the headers.
 * Headers can arrive at once while the body stalls, and a deadline that ended at the headers
 * left a panel "Reading…" for as long as the body took - measured at 47 s on a 30 s deadline.
 */
async function fetchBody(url: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  // Every request settles. Without a deadline a hung fetch never resolves and
  // never rejects, so a caller's `finally` never runs and whatever it set while
  // waiting - a loading flag, a spinner, a disabled button - stays set for the
  // life of the page. Those were fixed one at a time as ownership bugs; the
  // flags were owned correctly and the thing meant to clear them never came
  // back.
  const timeoutMs = timeoutForBody(init?.body);
  const deadline = deadlineSignal(timeoutMs, init?.signal);
  try {
    const response = await watchedFetch(() => fetchNamingLinkFailure(resolveAppUrl(url), { ...init, headers, signal: deadline.signal }), { upload: init?.body instanceof FormData, callerAborted: () => init?.signal?.aborted === true });
    return await readResponse(url, response);
  } catch (error) {
    // An abort that was ours is a deadline, and says so. An abort the caller
    // asked for is theirs and is passed through unchanged, and so is a status
    // the server did answer with.
    if (error instanceof HttpError) throw error;
    if (deadline.signal.aborted && init?.signal?.aborted !== true) throw new RequestTimeoutError(url, timeoutMs);
    throw error;
  } finally {
    deadline.done();
  }
}

async function readResponse(url: string, response: Response): Promise<unknown> {
  // The server answered - a 500 from it disproves "the link is down" just as
  // much as a 200 does - so the transport report fires before the status is
  // judged.
  reportTransportReachable(url);
  if (!response.ok) {
    const body: unknown = await response.json().catch((): unknown => ({}));
    // The gateway answers with its own label plus the evidence (detail) and
    // the machine it failed for - a transport claim that names its machine.
    const fields = isRecord(body) ? body : {};
    const label = typeof fields["error"] === "string" ? fields["error"] : response.statusText;
    const detail = typeof fields["detail"] === "string" ? fields["detail"] : undefined;
    // A body without a machineId is still a claim about the machine the URL
    // names: the local proxy's 502 speaks about that machine's daemon, and
    // without the fallback it lands as a page claim that any other machine's
    // success would erase.
    const namedMachineId = typeof fields["machineId"] === "string" ? fields["machineId"] : undefined;
    const machineId = namedMachineId ?? machineIdFromUrl(url);
    const text = detail === undefined || detail === "" ? label : `${label} (${detail})`;
    const missing = routeMissingCode(response.status, body);
    if (missing !== undefined) throw new HttpError(ROUTE_MISSING_WORDS, response.status, machineId, undefined, missing);
    throw new HttpError(apiErrorMessage({ error: text }) ?? text, response.status, machineId, namedMachineId === undefined ? undefined : "gateway", errorCode(body), transportFailureOf(body));
  }
  if (answeredWithPage(response)) throw new HttpError(ROUTE_MISSING_WORDS, 404, machineIdFromUrl(url), undefined, ROUTE_MISSING_CODE);
  const body: unknown = await response.json();
  return body;
}

/** What a page says when the machine it asked is older than the page and has no such route. */
export const ROUTE_MISSING_WORDS = "This machine runs an older PI WEB that cannot do this yet. Update PI WEB there and restart its session daemon.";

/**
 * A machine whose web process predates a route answers its path with the app's own page, at 200: the
 * document, not data. Read as JSON it threw a parse error that the page showed as it was.
 */
function answeredWithPage(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

/**
 * The route-missing answer, typed: a newer machine names the code; an older one sends Fastify's own
 * not-found envelope, read by its shape until every machine carries the code (rolling compatibility).
 */
function routeMissingCode(status: number, body: unknown): typeof ROUTE_MISSING_CODE | undefined {
  if (status !== 404 || !isRecord(body)) return undefined;
  if (body["code"] === ROUTE_MISSING_CODE) return ROUTE_MISSING_CODE;
  const message = body["message"];
  return body["code"] === undefined && body["statusCode"] === 404 && body["error"] === "Not Found" && typeof message === "string" && /^Route [A-Z]+:\S+ not found$/u.test(message) ? ROUTE_MISSING_CODE : undefined;
}

/** The typed code an error body names, such as the daemon's missing session (object model §1.6). */
export function errorCode(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const code = value["code"];
  return typeof code === "string" ? code : undefined;
}

/** The `transport` field of an error body (B16), when it names one this page knows. */
export function transportFailureOf(value: unknown): TransportFailure | undefined {
  if (!isRecord(value)) return undefined;
  const transport = value["transport"];
  return TRANSPORT_FAILURES.find((failure) => failure === transport);
}

/** The `error` text of an API failure body, when it carries one. */
export function apiErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value["error"] === "string" ? value["error"] : undefined;
}

