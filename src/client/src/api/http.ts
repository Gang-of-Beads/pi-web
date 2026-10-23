import { isRecord } from "../../../shared/unknownValues";
import { resolveAppUrl } from "../appUrl";
import { machineIdFromUrl, reportTransportReachable } from "./transportHealth";
import { deadlineSignal, fetchNamingLinkFailure, MACHINE_READ_DEADLINE_MS, NetworkError, RequestTimeoutError, timeoutForBody } from "./requestDeadline";
import { directMachines, directMachineUrl } from "../directMachineUrl";
import type { TransportClaim } from "./transportClaim";
import { dedupeKey, shareInFlight } from "./inFlight";
import { watchedFetch } from "./ackWatch";
import { ACCESS_REQUIRED_CODE, ROUTE_MISSING_CODE, TRANSPORT_FAILURES, type TransportFailure } from "../../../shared/apiTypes";
import { signInPageUrl } from "./urls";

/**
 * Who answered with the error, when it is known. Only PI WEB's gateway names
 * the machine it failed for in its body; a proxy in front of PI WEB answering
 * for a remote machine's URL says nothing about that machine. A machine this
 * browser reaches itself has no gateway: this browser saw it not answer.
 */
export type HttpErrorOrigin = "gateway" | "this-browser";

export class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly machineId?: string, readonly answeredBy?: HttpErrorOrigin, readonly code?: string, readonly transport?: TransportClaim) {
    super(message);
    this.name = "HttpError";
  }
}

export type TransportObservation = "application" | "isolated";

/** Who waits on a read: the reader, on the ordinary budget, or nobody, when the page reads about a machine on its own. */
export type ReadAsker = "reader" | "background";

export function request<T>(url: string, parse: (value: unknown) => T, init?: RequestInit, observation: TransportObservation = "application"): Promise<T> {
  return requestWithin(timeoutForBody(init?.body), url, parse, init, observation);
}

/**
 * A read the page makes on its own about a machine (r156): it gives up at the machine read deadline,
 * so a machine that does not answer holds one of the browser's few connections to the server no
 * longer than the Machines list's check waits. What it gave up on stays unknown to its caller.
 */
export function machineRead<T>(url: string, parse: (value: unknown) => T, init?: RequestInit, observation: TransportObservation = "application"): Promise<T> {
  return requestWithin(MACHINE_READ_DEADLINE_MS, url, parse, init, observation);
}

/** The read for each asker; a read that serves both is asked by whoever waits on it. */
export const READ_FOR: Readonly<Record<ReadAsker, typeof request>> = { reader: request, background: machineRead };

async function requestWithin<T>(timeoutMs: number, url: string, parse: (value: unknown) => T, init: RequestInit | undefined, observation: TransportObservation): Promise<T> {
  // Reads for the same url share one round trip while it is unsettled; each
  // caller then parses the same body with its own parser. Writes never share:
  // two sends that look identical are two messages, and what makes a repeat
  // safe lives in the daemon's operation ledger, not in a client-side map. A
  // caller that brought its own abort signal keeps its own request, because
  // sharing would let one caller's cancellation settle another's read, and an
  // isolated read (a machine probe) never shares, so a probe never adopts an
  // application read's result or the other way round.
  const shareKey = observation === "application" && (init?.signal === undefined || init.signal === null) ? dedupeKey(url, init?.method) : undefined;
  const body = await shareInFlight(shareKey, () => fetchBody(url, init, observation, timeoutMs));
  return parse(body);
}

/**
 * One request, bounded end to end: the deadline covers the body as well as the headers.
 * Headers can arrive at once while the body stalls, and a deadline that ended at the headers
 * left a panel "Reading…" for as long as the body took - measured at 47 s on a 30 s deadline.
 */
async function fetchBody(url: string, init: RequestInit | undefined, observation: TransportObservation, timeoutMs: number): Promise<unknown> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  // Every request settles. Without a deadline a hung fetch never resolves and
  // never rejects, so a caller's `finally` never runs and whatever it set while
  // waiting - a loading flag, a spinner, a disabled button - stays set for the
  // life of the page. Those were fixed one at a time as ownership bugs; the
  // flags were owned correctly and the thing meant to clear them never came
  // back.
  const deadline = deadlineSignal(timeoutMs, init?.signal);
  const routedTo = routingOf(url);
  try {
    const fetchResponse = () => fetchNamingLinkFailure(resolveAppUrl(url), { ...init, headers, signal: deadline.signal });
    const response = await (observation === "isolated" ? fetchResponse() : watchedFetch(fetchResponse, { upload: init?.body instanceof FormData, callerAborted: () => init?.signal?.aborted === true }));
    return await readResponse(url, response, observation, routedTo);
  } catch (error) {
    // An abort that was ours is a deadline, and says so. An abort the caller
    // asked for is theirs and is passed through unchanged, and so is a status
    // the server did answer with.
    if (error instanceof HttpError) throw error;
    const unanswered = deadline.signal.aborted && init?.signal?.aborted !== true ? new RequestTimeoutError(url, timeoutMs) : error;
    throw directMachineSilence(url, init, unanswered) ?? unanswered;
  } finally {
    deadline.done();
  }
}

const READ_METHODS = new Set(["GET", "HEAD"]);

/**
 * A read that a machine this browser reaches itself did not answer: that machine is out of reach
 * from this device, not this page's own link (browser-direct-machines.md, "Reachability"). It is
 * shaped as the gateway's machine-unreachable claim (504, machineId, transport), so the app row
 * names that machine. A write keeps its own failure, whose outcome is unknown and which the send
 * ledger judges by its type.
 */
function directMachineSilence(url: string, init: RequestInit | undefined, error: unknown): HttpError | undefined {
  if (!READ_METHODS.has((init?.method ?? "GET").toUpperCase())) return undefined;
  if (!(error instanceof NetworkError) && !(error instanceof RequestTimeoutError)) return undefined;
  const machineId = machineIdFromUrl(url);
  if (machineId === undefined || directMachineUrl(url, directMachines()) === undefined) return undefined;
  return new HttpError("This browser cannot reach the machine.", 504, machineId, "this-browser", undefined, "machine-unreachable");
}

async function readResponse(url: string, response: Response, observation: TransportObservation, routedTo: RequestRouting): Promise<unknown> {
  // The server answered - a 500 from it disproves "the link is down" just as
  // much as a 200 does - so an application read reports the link reachable
  // before the status is judged; an isolated probe read does not, so a probe
  // answer cannot mark the app-wide link reachable.
  if (observation === "application") reportTransportReachable(url);
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
    const accessRequired = response.status === 401 && errorCode(body) === ACCESS_REQUIRED_CODE ? routedTo : undefined;
    if (accessRequired !== undefined) throw ACCESS_REQUIRED_ANSWER[accessRequired](response, machineId);
    throw new HttpError(apiErrorMessage({ error: text }) ?? text, response.status, machineId, namedMachineId === undefined ? undefined : "gateway", errorCode(body), transportFailureOf(body));
  }
  if (answeredWithPage(response)) throw new HttpError(ROUTE_MISSING_WORDS, 404, machineIdFromUrl(url), undefined, ROUTE_MISSING_CODE);
  const body: unknown = await response.json();
  return body;
}

/**
 * Where a request was routed, which decides who asked for an access token when it is refused with
 * `access-required` (docs/install.md, "Require an access token"), rather than the answer's origin: a machine this browser reaches itself may share
 * this page's origin under another prefix, and its sign-in page is not this server's. Only a request
 * this server answered means "sign in here": a gateway never passes a remote's refusal through, and
 * a page cannot sign in to a machine it reaches directly.
 */
type RequestRouting = "this-server" | "direct-machine";

/**
 * Where a request went, decided when it is sent: the roster can change before the answer arrives
 * (removing a machine this browser reaches itself drops it from the roster while a last request to it
 * is in flight), and a late answer must still be read as that machine's.
 */
function routingOf(url: string): RequestRouting {
  return directMachineUrl(url, directMachines()) === undefined ? "this-server" : "direct-machine";
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

let signInRequested = false;

/** Drafts and outboxes are already in IndexedDB, so leaving for the sign-in page loses nothing. */
const ACCESS_REQUIRED_ANSWER: Readonly<Record<RequestRouting, (response: Response, machineId: string | undefined) => HttpError>> = {
  "this-server": (response, machineId) => {
    if (!signInRequested) {
      signInRequested = true;
      location.assign(signInPageUrl(location.search));
    }
    return new HttpError("PI WEB asks you to sign in.", response.status, machineId, undefined, ACCESS_REQUIRED_CODE);
  },
  "direct-machine": (response, machineId) => new HttpError(
    `${originOf(response.url) ?? "This machine"} requires an access token. Remove it and add it again with This server.`,
    response.status,
    machineId,
    undefined,
    ACCESS_REQUIRED_CODE,
  ),
};

/** What a page says when the machine it asked is older than the page and has no such route. */
export const ROUTE_MISSING_WORDS = "This machine runs an older PI WEB that cannot do this yet. Update PI WEB there and restart its session daemon.";

/**
 * A machine whose web process predates a route answers its path with the app's own page, at 200: the
 * document, not data. Read as JSON it threw a parse error that the page showed as it was.
 */
function answeredWithPage(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

/** The route-missing answer, read by its code alone. */
function routeMissingCode(status: number, body: unknown): typeof ROUTE_MISSING_CODE | undefined {
  return status === 404 && isRecord(body) && body["code"] === ROUTE_MISSING_CODE ? ROUTE_MISSING_CODE : undefined;
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

