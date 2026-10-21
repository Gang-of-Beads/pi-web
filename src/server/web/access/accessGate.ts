import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isLoopbackHost } from "../../../accessTokenConfig.js";
import { ACCESS_REQUIRED_CODE, ACCESS_THROTTLED_CODE } from "../../../shared/apiTypes.js";
import { routeMissingBody } from "../../shared/routeMissing.js";
import { serializedOrigin } from "../machineAccess/originAccess.js";
import { createAccessAttemptLimiter, type AccessAttemptLimiter, type AccessLimit } from "./accessAttemptLimiter.js";
import { accessCookieName, accessCredentials, COOKIE_MAX_AGE_SECONDS, type AccessCredentials, type CookieKey } from "./accessCookie.js";
import { signInPage, SIGN_IN_PAGE_CSP, type SignInPageFacts } from "./accessSignInPage.js";
import { accessVerdict, isBaseDocumentRead, judgedCredentials, SIGN_IN_PATH, signInLocation, type AccessCredential, type AccessVerdict, type JudgedCredentials } from "./accessVerdict.js";

/**
 * The web/API's optional access gate (docs/install.md, "Require an access token").
 *
 * One root `onRequest` hook, registered before every route, so it runs for static files, the
 * not-found handler, mounted plugin routes and WebSocket upgrades alike (`@fastify/websocket` routes
 * an upgrade through the router with a plain response on the socket, so a refusal is an HTTP 401
 * before the upgrade). The pure `accessVerdict` decides; the executors below carry the verdict out.
 * Credentials are a `Bearer` token, an `X-PI-WEB-Access-Token` header (for remotes whose
 * authenticating proxy already takes `Authorization`), or the sign-in cookie. Never a query string:
 * it would leak into history, logs and `Referer`.
 */

export interface AccessGateOptions {
  readonly tokens: readonly string[];
  /** Names the cookie when the `Host` header names no port (see `accessCookieName`). */
  readonly listenPort: number;
  readonly now?: () => number;
}

const ACCESS_TOKEN_HEADER = "x-pi-web-access-token";
const FORM_BODY_LIMIT_BYTES = 8 * 1024;

interface CredentialCheck {
  readonly credential: AccessCredential;
  /** A valid cookie old enough to be reissued, with the key that signed it. */
  readonly renewWith?: CookieKey;
  readonly retryAfterSeconds?: number;
  /** Which limit refused a throttled guess. */
  readonly throttledBy?: AccessLimit;
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function requestPath(request: FastifyRequest): string {
  return request.url.split("?", 1)[0] ?? "";
}

function requestQuery(request: FastifyRequest): string {
  const index = request.url.indexOf("?");
  return index === -1 ? "" : request.url.slice(index + 1);
}

function cookieValue(request: FastifyRequest, name: string): string | undefined {
  for (const pair of (header(request, "cookie") ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator !== -1 && pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim();
  }
  return undefined;
}

function presentedTokens(request: FastifyRequest): string[] {
  const bearer = /^Bearer\s+(\S+)\s*$/iu.exec(header(request, "authorization") ?? "")?.[1];
  const custom = header(request, ACCESS_TOKEN_HEADER)?.trim();
  return [bearer, custom].filter((token): token is string => token !== undefined && token !== "");
}

/** `X-Forwarded-Proto` can only make the cookie stricter, so trusting it is safe. */
function isEncrypted(request: FastifyRequest): boolean {
  return request.protocol === "https" || header(request, "x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https";
}

function sessionCookie(name: string, value: string, request: FastifyRequest): string {
  return `${name}=${value}; Max-Age=${String(COOKIE_MAX_AGE_SECONDS)}; HttpOnly; SameSite=Lax${isEncrypted(request) ? "; Secure" : ""}`;
}

function clearedCookie(name: string, request: FastifyRequest): string {
  return `${name}=; Max-Age=0; HttpOnly; SameSite=Lax${isEncrypted(request) ? "; Secure" : ""}`;
}

/** A refusal a pairing page on another machine can read: it carries no data, only why. */
function allowOriginToRead(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const origin = serializedOrigin(header(request, "origin"));
  if (origin === undefined) return reply;
  return reply.header("access-control-allow-origin", origin).header("vary", "Origin");
}

/**
 * A sign-in form post another site's page sent. Over HTTPS the origin gate (`registerMachineAccess`)
 * already refuses those by `Sec-Fetch-Site`; over plain HTTP browsers send no Fetch Metadata, so the
 * origin gate lets an `Origin` through as `unverified`. A present `Origin` (opaque `null` included)
 * that names another host than this request's is refused here; a missing one stays allowed for old
 * browsers. `X-Forwarded-Host` can only make a match, never a refusal, so a proxy that rewrites `Host`
 * keeps working; a browser page cannot set it.
 */
function postedFromAnotherSite(request: FastifyRequest): boolean {
  if (header(request, "sec-fetch-site") !== undefined) return false;
  const origin = header(request, "origin");
  if (origin === undefined) return false;
  const originHost = serializedOrigin(origin) === undefined ? undefined : new URL(origin).host;
  if (originHost === undefined) return true;
  const ownHosts = [request.host, header(request, "x-forwarded-host")?.split(",")[0]?.trim() ?? ""].map((host) => host.toLowerCase());
  return !ownHosts.includes(originHost);
}

/** The app query to return to; a repeated `next` (`?next=a&next=b`) uses the first. */
function nextQuery(value: string | readonly string[] | null | undefined): string {
  const first = typeof value === "string" || value === null || value === undefined ? value : value[0];
  return new URLSearchParams(first ?? "").toString();
}

function sendPage(reply: FastifyReply, status: number, facts: SignInPageFacts): FastifyReply {
  return reply
    .code(status)
    .header("content-security-policy", SIGN_IN_PAGE_CSP)
    .header("cache-control", "no-store")
    .header("x-content-type-options", "nosniff")
    .type("text/html; charset=utf-8")
    .send(signInPage(facts));
}

/** Registers the sign-in routes; called after the origin gate, so they sit behind it like every other route. */
export type RegisterSignInRoutes = () => Promise<void>;

const NOT_EVALUATED: CredentialCheck = { credential: "missing" };

/** The log line when a limit first trips, and the 429 answer while it holds, for the limit that tripped. */
const THROTTLED_WORDS: Readonly<Record<AccessLimit, { readonly log: string; readonly answer: string }>> = {
  address: {
    log: "Too many failed access attempts from this address; its token guesses are refused until the window ends",
    answer: "Too many failed access attempts from this address; try again later.",
  },
  overall: {
    log: "Too many failed access attempts from all addresses together; every address's token guesses are refused until the window ends",
    answer: "Too many failed access attempts overall, from all addresses; try again later.",
  },
};

/**
 * Adds the gate's hooks and returns the registration of its sign-in routes. The hooks must come
 * before every route; the routes must come after the origin gate (`registerMachineAccess`), whose
 * root hook a Fastify child scope only inherits when it is created later: another site's page may
 * then neither sign the reader out nor spend the reader's address's failed attempts.
 */
export function registerAccessGate(app: FastifyInstance, options: AccessGateOptions): RegisterSignInRoutes {
  const credentials: AccessCredentials = accessCredentials(options.tokens);
  const limiter: AccessAttemptLimiter = createAccessAttemptLimiter();
  const now = options.now ?? Date.now;
  const unauthenticatedPreflights = new WeakSet<FastifyRequest>();
  const cookieName = (request: FastifyRequest): string => accessCookieName(request.port, options.listenPort);

  const recordFailure = (request: FastifyRequest, at: number): void => {
    for (const tripped of limiter.recordFailure(request.ip, at)) app.log.warn({ peer: request.ip, limit: tripped }, THROTTLED_WORDS[tripped].log);
  };

  const checkCredentials = (request: FastifyRequest, at: number, judged: Exclude<JudgedCredentials, "none">): CredentialCheck => {
    const nowSeconds = Math.floor(at / 1000);
    const cookie = credentials.checkCookie(cookieName(request), cookieValue(request, cookieName(request)), nowSeconds);
    if (cookie.kind === "valid") return { credential: "valid", ...(credentials.needsRenewal(cookie.issuedAt, nowSeconds) ? { renewWith: cookie.key } : {}) };
    if (cookie.kind === "malformed" || cookie.kind === "forged") recordFailure(request, at);
    const tokens = judged === "any" ? presentedTokens(request) : [];
    if (tokens.length === 0) return { credential: "missing" };
    const allowance = limiter.allowance(request.ip, at);
    if (!allowance.allowed) return { credential: "throttled", throttledBy: allowance.limit, retryAfterSeconds: allowance.retryAfterSeconds };
    if (tokens.some((token) => credentials.matchToken(token) !== undefined)) return { credential: "valid" };
    recordFailure(request, at);
    return { credential: "missing" };
  };

  const executors: Record<AccessVerdict, (request: FastifyRequest, reply: FastifyReply, check: CredentialCheck, at: number) => FastifyReply | undefined> = {
    exempt: () => undefined,
    preflight: (request, _reply, check) => {
      if (check.credential !== "valid") unauthenticatedPreflights.add(request);
      return undefined;
    },
    authenticated: (request, reply, check, at) => {
      if (check.renewWith !== undefined && isBaseDocumentRead(request.method, requestPath(request))) {
        reply.header("set-cookie", sessionCookie(cookieName(request), credentials.mintCookie(cookieName(request), check.renewWith, Math.floor(at / 1000)), request));
      }
      return undefined;
    },
    throttled: (request, reply, check) => allowOriginToRead(request, reply)
      .code(429)
      .header("retry-after", String(check.retryAfterSeconds ?? 1))
      .send({ error: THROTTLED_WORDS[check.throttledBy ?? "address"].answer, code: ACCESS_THROTTLED_CODE }),
    "sign-in-redirect": (request, reply) => reply.header("cache-control", "no-store").redirect(signInLocation(requestPath(request), requestQuery(request)), 303),
    "refused-json": (request, reply) => allowOriginToRead(request, reply)
      .code(401)
      .send({ error: "This PI WEB requires an access token.", code: ACCESS_REQUIRED_CODE }),
    "refused-plain": (_request, reply) => reply.code(401).type("text/plain; charset=utf-8").send("This PI WEB requires an access token.\n"),
  };

  app.addHook("onRequest", async (request, reply) => {
    const at = now();
    const path = requestPath(request);
    const judged = judgedCredentials(request.method, path);
    const check = judged === "none" ? NOT_EVALUATED : checkCredentials(request, at, judged);
    const verdict = accessVerdict({ method: request.method, path, credential: check.credential });
    return executors[verdict](request, reply, check, at);
  });

  /** Before the body is read: an unauthenticated preflight's body is never buffered or parsed. */
  app.addHook("preParsing", async (request, reply, payload) => {
    if (unauthenticatedPreflights.has(request)) await reply.code(404).send(routeMissingBody(request.method, request.url));
    return payload;
  });

  return async () => {
    await app.register((scope, _options, done) => {
      scope.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, parsed) => {
        parsed(null, new URLSearchParams(typeof body === "string" ? body : body.toString("utf8")));
      });

      const pageFacts = (request: FastifyRequest, next: string): Omit<SignInPageFacts, "notice"> => ({
        signedIn: credentials.checkCookie(cookieName(request), cookieValue(request, cookieName(request)), Math.floor(now() / 1000)).kind === "valid",
        next,
        unencrypted: !isEncrypted(request) && !isLoopbackHost(request.hostname),
      });

      /**
       * The sign-in page is also where the app renews the cookie while it is in use (`accessGate.ts` in
       * the client): `access` sits at the app's base, so the renewed cookie keeps the base as its path,
       * and the Vite dev server proxies it to this process, which it does not do for the document.
       */
      scope.get<{ Querystring: { next?: string | string[] } }>(SIGN_IN_PATH, (request, reply) => {
        const at = now();
        const cookie = credentials.checkCookie(cookieName(request), cookieValue(request, cookieName(request)), Math.floor(at / 1000));
        if (cookie.kind === "valid" && credentials.needsRenewal(cookie.issuedAt, Math.floor(at / 1000))) {
          reply.header("set-cookie", sessionCookie(cookieName(request), credentials.mintCookie(cookieName(request), cookie.key, Math.floor(at / 1000)), request));
        }
        return sendPage(reply, 200, { ...pageFacts(request, nextQuery(request.query.next)), notice: "none" });
      });

      scope.post<{ Body: unknown }>(SIGN_IN_PATH, { bodyLimit: FORM_BODY_LIMIT_BYTES }, async (request, reply) => {
        if (postedFromAnotherSite(request)) return reply.code(403).type("text/plain; charset=utf-8").send("Sign in from this PI WEB's own page.\n");
        if (!(request.body instanceof URLSearchParams)) return reply.code(415).type("text/plain; charset=utf-8").send("Sign in with the form on this page.\n");
        const form = request.body;
        if (form.get("intent") === "sign-out") return reply.header("set-cookie", clearedCookie(cookieName(request), request)).redirect(SIGN_IN_PATH.slice(1), 303);
        const next = nextQuery(form.get("next"));
        const at = now();
        const allowance = limiter.allowance(request.ip, at);
        if (!allowance.allowed) {
          return sendPage(reply.header("retry-after", String(allowance.retryAfterSeconds)), 429, { ...pageFacts(request, next), signedIn: false, notice: `throttled-${allowance.limit}` });
        }
        const key = credentials.matchToken((form.get("token") ?? "").trim());
        if (key === undefined) {
          recordFailure(request, at);
          return sendPage(reply, 401, { ...pageFacts(request, next), signedIn: false, notice: "wrong-token" });
        }
        return reply
          .header("set-cookie", sessionCookie(cookieName(request), credentials.mintCookie(cookieName(request), key, Math.floor(at / 1000)), request))
          .header("cache-control", "no-store")
          .redirect(next === "" ? "./" : `./?${next}`, 303);
      });
      done();
    });
  };
}
