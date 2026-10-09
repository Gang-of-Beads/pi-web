import type { TransportFailure } from "../../shared/apiTypes.js";
import { RemoteMachineRequestError } from "../../server-plugin-api.js";
import { isNodeErrorWithCode } from "./workspaces/pathSafety.js";

/**
 * The `transport` field of an error body that reports the session daemon unreachable (B16).
 *
 * Only "nothing is listening" heals by itself: ECONNREFUSED while the daemon restarts, ENOENT
 * when its socket file is gone. Any other failure to reach it (a permission refused, a reset)
 * keeps its own words, as it did when the page read the errno out of the message.
 */
const NOT_LISTENING_ERRNOS = ["ECONNREFUSED", "ENOENT"] as const;

export function daemonTransport(error: unknown): { readonly transport?: TransportFailure } {
  const failures = [error, error instanceof Error ? error.cause : undefined];
  return failures.some((failure) => NOT_LISTENING_ERRNOS.some((code) => isNodeErrorWithCode(failure, code))) ? { transport: "daemon-not-listening" } : {};
}

/**
 * The `transport` field of a gateway's error body: the remote machine client's own failure
 * (`RemoteMachineRequestError`: no answer, no answer in time, or a broken one) puts the machine
 * out of reach; an answer the gateway could not use, such as a malformed plugin manifest, keeps its
 * words. A timeout is reported as out of reach too: from the page, a machine that did not answer in
 * time is one it cannot reach, and the row has always said so in the same words.
 */
export function gatewayTransport(error: unknown): { readonly transport?: TransportFailure } {
  return error instanceof RemoteMachineRequestError ? { transport: "machine-unreachable" } : {};
}
