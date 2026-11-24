/**
 * An access token carried in the path, for a page that reaches a machine on another origin
 * (docs/design/browser-direct-machines.md, "Gated machines").
 *
 * Such a page cannot sign in there: the machine's cookie does not cross origins, and a socket, an
 * image, a frame and a module import cannot set a header. A query parameter would cover those, but
 * not what they load in turn: a plugin module's own relative imports resolve against its path and
 * drop its query. So the token is a prefix of the path, `access-token/<token>/`, in front of the
 * machine's ordinary paths. PI WEB's paths are relative to its base everywhere, so everything a
 * prefixed URL loads keeps the prefix. The machine strips it before routing and reads the token as
 * if it had come in the `X-PI-WEB-Access-Token` header.
 */
const SEGMENT = "access-token";
const PREFIXED = new RegExp(`^/${SEGMENT}/([^/?#]+)(/[^?#]*)?(.*)$`, "u");

/** The machine's base URL with the token in front of everything under it; the base itself without a token. */
export function accessTokenBaseUrl(baseUrl: string, token: string | undefined): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return token === undefined || token === "" ? base : `${base}${SEGMENT}/${encodeURIComponent(token)}/`;
}

/** A request URL as the server received it, split into the URL to route and the token its path carried. */
export function splitAccessTokenPath(url: string): { url: string; token?: string } {
  const match = PREFIXED.exec(url);
  if (match?.[1] === undefined) return { url };
  try {
    return { url: `${match[2] ?? "/"}${match[3] ?? ""}`, token: decodeURIComponent(match[1]) };
  } catch {
    return { url };
  }
}
