import { notFoundAnswer } from "../notFoundAnswer.js";

/**
 * What the access gate does with one request (docs/install.md, "Require an access token").
 *
 * Paths are as the server sees them, a reverse proxy's prefix already stripped. Only exact paths are
 * exempt, so an encoded or doubled spelling of one is gated like any other path and can only lose its
 * exemption, never gain one. An unknown path is gated as its class, so a refusal does not reveal which
 * routes exist.
 *
 * - `exempt`: the sign-in page and the PWA metadata browsers fetch without cookies.
 * - `preflight`: a CORS preflight, which the origin hook answers; no route handler may take it unauthenticated.
 * - `authenticated`: a valid token or sign-in cookie.
 * - `throttled`: a token guess from an address over the failure limit, refused without being evaluated.
 * - `sign-in-redirect`: the app document, sent to the sign-in page.
 * - `refused-json`: the API, plugin assets and sockets, refused with `access-required`.
 * - `refused-plain`: built assets and anything else, refused in plain text.
 */
export type AccessVerdict = "exempt" | "authenticated" | "preflight" | "throttled" | "sign-in-redirect" | "refused-json" | "refused-plain";

/** What the presented credentials came to; the gate evaluates them before it classifies. */
export type AccessCredential = "valid" | "missing" | "throttled";

export type AccessRouteClass = "sign-in" | "pwa-metadata" | "document" | "asset" | "api" | "plugin-asset";

export interface AccessFacts {
  readonly method: string;
  readonly path: string;
  readonly credential: AccessCredential;
}

export const SIGN_IN_PATH = "/access";

const PWA_METADATA_PATHS: ReadonlySet<string> = new Set([
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
]);

const EXEMPT_METHODS: Readonly<Record<"sign-in" | "pwa-metadata", ReadonlySet<string>>> = {
  "sign-in": new Set(["GET", "HEAD", "POST"]),
  "pwa-metadata": new Set(["GET", "HEAD"]),
};

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

const REFUSAL_BY_CLASS: Readonly<Record<AccessRouteClass, (method: string) => AccessVerdict>> = {
  "sign-in": () => "refused-plain",
  "pwa-metadata": () => "refused-plain",
  document: (method) => (READ_METHODS.has(method) ? "sign-in-redirect" : "refused-plain"),
  asset: () => "refused-plain",
  api: () => "refused-json",
  "plugin-asset": () => "refused-json",
};

export function accessRouteClass(path: string): AccessRouteClass {
  if (path === SIGN_IN_PATH) return "sign-in";
  if (PWA_METADATA_PATHS.has(path)) return "pwa-metadata";
  if (path === "/pi-web-plugins" || path.startsWith("/pi-web-plugins/")) return "plugin-asset";
  const answer = notFoundAnswer(path);
  return answer === "missing-api" ? "api" : answer === "missing-asset" ? "asset" : "document";
}

function isExempt(routeClass: AccessRouteClass, method: string): boolean {
  return (routeClass === "sign-in" || routeClass === "pwa-metadata") && EXEMPT_METHODS[routeClass].has(method);
}

/**
 * Which credentials the gate evaluates for a request:
 * - `none`: an exempt request, answered whatever it carries;
 * - `cookie`: a read of the app document, which only browsers make, so only the sign-in cookie is
 *   judged. A `Bearer` header an authenticating proxy injects into every request is then never
 *   counted as a failed guess there, and a signed-out reader always reaches the sign-in page;
 * - `any`: everything else, by cookie, `Bearer` or `X-PI-WEB-Access-Token`.
 */
export type JudgedCredentials = "none" | "cookie" | "any";

export function judgedCredentials(method: string, path: string): JudgedCredentials {
  if (method === "OPTIONS") return "any";
  const routeClass = accessRouteClass(path);
  if (isExempt(routeClass, method)) return "none";
  return routeClass === "document" && READ_METHODS.has(method) ? "cookie" : "any";
}

export function accessVerdict(facts: AccessFacts): AccessVerdict {
  if (facts.method === "OPTIONS") return "preflight";
  const routeClass = accessRouteClass(facts.path);
  if (isExempt(routeClass, facts.method)) return "exempt";
  if (facts.credential === "valid") return "authenticated";
  if (facts.credential === "throttled") return "throttled";
  return REFUSAL_BY_CLASS[routeClass](facts.method);
}

/**
 * A read of the app document at the base, the one place besides the sign-in page where the gate sets
 * its cookie: the cookie has no `Path`, so the browser scopes it to the directory of the URL it came
 * with, and only a base-level URL makes that directory the app's base under any prefix.
 */
export function isBaseDocumentRead(method: string, path: string): boolean {
  return READ_METHODS.has(method) && (path === "/" || path === "/index.html");
}

/** The sign-in page relative to a request's own depth: the server never knows the proxy's prefix. */
export function signInLocation(path: string, query: string): string {
  const depth = Math.max(0, path.split("/").length - 2);
  const next = new URLSearchParams(query).toString();
  return `${"../".repeat(depth)}access${next === "" ? "" : `?${new URLSearchParams({ next }).toString()}`}`;
}
