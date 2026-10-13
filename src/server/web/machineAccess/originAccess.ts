/**
 * Which page a browser request comes from, in the browser's own words (docs/design/browser-direct-machines.md).
 *
 * `Sec-Fetch-Site` is set by the browser from the page's origin, and no proxy rewrites it, so it
 * decides. The `Host` header is deliberately not consulted: a reverse proxy that rewrites it (nginx's
 * default) would make this machine's own page look foreign.
 *
 * - `not-a-browser`: no `Origin` and no recognised `Sec-Fetch-Site` - another machine's server, curl.
 * - `own-page`: a page this machine served.
 * - `approved`: another machine's page whose origin this machine approved.
 * - `unapproved`: a foreign (`same-site` or `cross-site`) request whose origin is missing or not approved.
 * - `unverified`: an `Origin` without a recognised `Sec-Fetch-Site` (an old browser); it keeps today's behaviour.
 */
export type OriginAccess = "not-a-browser" | "own-page" | "approved" | "unapproved" | "unverified";

export interface BrowserRequestFacts {
  readonly origin: string | undefined;
  readonly fetchSite: string | undefined;
}

const SITE_RELATION: Readonly<Record<string, "own" | "foreign">> = {
  "same-origin": "own",
  none: "own",
  "same-site": "foreign",
  "cross-site": "foreign",
};

export function originAccess(facts: BrowserRequestFacts, isApproved: (origin: string) => boolean): OriginAccess {
  const relation = facts.fetchSite === undefined ? undefined : SITE_RELATION[facts.fetchSite];
  if (relation === "own") return "own-page";
  if (facts.origin === undefined) return relation === undefined ? "not-a-browser" : "unapproved";
  if (isApproved(facts.origin)) return "approved";
  return relation === undefined ? "unverified" : "unapproved";
}

/** A browser-serialized origin (`https://host[:port]`), or undefined for anything else, including the opaque `null`. */
export function serializedOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin === value ? value : undefined;
  } catch {
    return undefined;
  }
}
