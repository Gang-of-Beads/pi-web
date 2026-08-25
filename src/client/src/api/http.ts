import { resolveAppUrl } from "../appUrl";

/**
 * A failed response, carrying the status the server answered with.
 *
 * Without it every failure looked alike to a caller, so "there is nothing here
 * to show" was reported in the same red banner as "the machine is unreachable".
 * Some callers can answer a 404 gracefully; they need to be able to tell.
 */
export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}

/** Whether a rejection is the server saying it has nothing at that address. */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}

export async function request<T>(url: string, parse: (value: unknown) => T, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(resolveAppUrl(url), { ...init, headers });
  if (!response.ok) {
    const body: unknown = await response.json().catch((): unknown => ({}));
    throw new HttpError(errorMessage(body) ?? response.statusText, response.status);
  }
  const body: unknown = await response.json();
  return parse(body);
}

function errorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value["error"] === "string" ? value["error"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
