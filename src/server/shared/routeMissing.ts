import { ROUTE_MISSING_CODE } from "../../shared/apiTypes.js";

/**
 * The answer for a route this process does not have: Fastify's own not-found envelope, which an
 * older client still matches by its text, with the typed code a newer client reads (B16). Both
 * processes answer it, so a page newer than the machine it talks to can say the machine is older
 * instead of showing a parse error or a raw "Route POST:... not found".
 */
export function routeMissingBody(method: string, url: string): { message: string; error: "Not Found"; statusCode: 404; code: typeof ROUTE_MISSING_CODE } {
  return { message: `Route ${method}:${url} not found`, error: "Not Found", statusCode: 404, code: ROUTE_MISSING_CODE };
}
