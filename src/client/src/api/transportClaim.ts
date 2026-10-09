import type { TransportFailure } from "../../../shared/apiTypes";
import { HttpError } from "./http";
import { NetworkError, RequestTimeoutError } from "./requestDeadline";

/**
 * What a failure claims about the link, by where it came from (B16).
 *
 * The page used to decide this by reading the failure's words against a table of phrasings, so
 * every producer whose words drifted kept a red line on screen after the link was back. A claim
 * now comes from the failure's type: the web process's `transport` field (nothing listening at
 * the daemon, a remote machine out of reach), the browser's own deadline, a fetch that the link
 * failed under, a request aborted under the page, or a 5xx that said nothing. Each heals by
 * itself, so the next answer retires it.
 */
export type TransportClaim = TransportFailure | "network" | "deadline" | "aborted" | "server-error";

export function transportClaimOf(error: unknown): TransportClaim | undefined {
  if (error instanceof RequestTimeoutError) return "deadline";
  if (error instanceof NetworkError) return "network";
  if (error instanceof HttpError) return error.transport ?? httpTransportClaim(error);
  return isAbort(error) ? "aborted" : undefined;
}

/** An abort is named by the platform's error type, AbortError, not by its message. */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function httpTransportClaim(error: HttpError): TransportClaim | undefined {
  if (error.message === "" && error.status >= 500) return "server-error";
  return legacyTransportClaim(error.message);
}

/**
 * A machine older than the `transport` field answers its transport failures in words only, so an
 * answer without the field is still read by its phrasing until every machine carries it (rolling
 * compatibility, as route-missing does). A code does not exempt an answer: an older machine's
 * plugin proxies sent `code: "daemon-unavailable"` with the daemon's refused-socket words. The phrasings are the ones those machines send: the
 * daemon's refused or missing socket, a cancelled fetch, a deadline, the gateway's two labels and
 * the anchored browser fetch failures.
 */
const LEGACY_PHRASES: readonly (readonly [(text: string) => boolean, TransportClaim])[] = [
  [(text) => /unavailable: connect (enoent|econnrefused)/iu.test(text) && /sessiond\.sock|session daemon/iu.test(text), "daemon-not-listening"],
  [(text) => /\boperation was aborted\b/iu.test(text), "aborted"],
  [(text) => /remote machine request cancelled/iu.test(text), "machine-unreachable"],
  [(text) => /did not answer within/iu.test(text), "deadline"],
  [(text) => /^(failed to fetch|load failed|networkerror when attempting to fetch resource)[.!]?$/iu.test(text), "network"],
  [(text) => /^remote machine (unavailable|timeout)/iu.test(text), "machine-unreachable"],
];

export function legacyTransportClaim(text: string): TransportClaim | undefined {
  return LEGACY_PHRASES.find(([spoken]) => spoken(text))?.[1];
}
