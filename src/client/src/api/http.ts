import { resolveAppUrl } from "../appUrl";
import { reportTransportReachable } from "./transportHealth";
import { deadlineSignal, RequestTimeoutError, timeoutForBody } from "./requestDeadline";

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}

export async function request<T>(url: string, parse: (value: unknown) => T, init?: RequestInit): Promise<T> {
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
  let response: Response;
  try {
    response = await fetch(resolveAppUrl(url), { ...init, headers, signal: deadline.signal });
  } catch (error) {
    // An abort that was ours is a deadline, and says so. An abort the caller
    // asked for is theirs and is passed through unchanged.
    if (deadline.signal.aborted && init?.signal?.aborted !== true) throw new RequestTimeoutError(url, timeoutMs);
    throw error;
  } finally {
    deadline.done();
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch((): unknown => ({}));
    throw new HttpError(errorMessage(body) ?? response.statusText, response.status);
  }
  const body: unknown = await response.json();
  // The server answered, so whatever transport complaint is on screen is now
  // describing the past.
  reportTransportReachable();
  return parse(body);
}

function errorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value["error"] === "string" ? value["error"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
