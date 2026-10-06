import { resolveAppUrl } from "../appUrl";
import { machineIdFromUrl, reportTransportReachable } from "./transportHealth";
import { deadlineSignal, RequestTimeoutError, timeoutForBody } from "./requestDeadline";
import { dedupeKey, shareInFlight } from "./inFlight";

/**
 * Who answered with the error, when it is known. Only PI WEB's gateway names
 * the machine it failed for in its body; a proxy in front of PI WEB answering
 * for a remote machine's URL says nothing about that machine.
 */
export type HttpErrorOrigin = "gateway";

export class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly machineId?: string, readonly answeredBy?: HttpErrorOrigin, readonly code?: string) {
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
    return await readResponse(url, await fetch(resolveAppUrl(url), { ...init, headers, signal: deadline.signal }));
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
    throw new HttpError(apiErrorMessage({ error: text }) ?? text, response.status, machineId, namedMachineId === undefined ? undefined : "gateway", errorCode(body));
  }
  const body: unknown = await response.json();
  return body;
}

/** The typed code an error body names, such as the daemon's missing session (object model §1.6). */
export function errorCode(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const code = value["code"];
  return typeof code === "string" ? code : undefined;
}

/** The `error` text of an API failure body, when it carries one. */
export function apiErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value["error"] === "string" ? value["error"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
