import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InjectOptions } from "fastify";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { noServerPlugins } from "./app.testSupport.js";
import type { PiWebConfigResponse } from "../../shared/apiTypes.js";
import type { PiWebConfigService } from "./configRoutes.js";
import type { SessionProxyDaemon } from "./sessionProxyRoutes.js";
import { AccessTokenConfigError, accessTokenConfig } from "../../accessTokenConfig.js";

/**
 * What a browser holding a cached page from the previous build gets.
 *
 * Reported as "the page is black, but incognito works", which is what a blank
 * SPA looks like from the outside. The cached index.html names hashed assets
 * from the build that produced it; after an upgrade those names are gone, and
 * the not-found handler answered them with index.html - so a <script> tag
 * received HTML, threw on the first `<`, and rendered nothing. Incognito had no
 * cached document, so it was fine, which made it look like a data problem
 * rather than a caching one.
 */

async function clientDistWithAssets(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-client-dist-"));
  await writeFile(join(dir, "index.html"), "<!doctype html><html><body>app</body></html>", "utf8");
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "assets", "index-CURRENT.js"), "export const ok = true;\n", "utf8");
  await writeFile(join(dir, "manifest.webmanifest"), "{\"name\":\"PI WEB\"}\n", "utf8");
  return dir;
}

/** The smallest config service buildApp accepts; nothing here reads it. */
function emptyConfigService(): PiWebConfigService {
  const response: PiWebConfigResponse = {
    path: join(tmpdir(), "pi-web-static-assets-config.json"),
    exists: false,
    config: {},
    effectiveConfig: {},
    envOverrides: { host: false, port: false, allowedHosts: false },
  };
  return { read: () => Promise.resolve(response), write: () => Promise.resolve(response) };
}

async function appWithClient() {
  return buildApp({
    config: emptyConfigService(),
    clientDist: await clientDistWithAssets(),
    logger: false,
    serverPluginRuntime: await noServerPlugins(),
  });
}

describe("static client assets", () => {
  it("404s an asset that no longer exists instead of serving the document", async () => {
    const app = await appWithClient();
    try {
      const response = await app.inject({ method: "GET", url: "/assets/index-FROM-A-PREVIOUS-BUILD.js" });

      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).not.toContain("text/html");
    } finally {
      await app.close();
    }
  });

  /** An unknown /api path answered 200 with the document, so a client read HTML where it expected an answer or a refusal. */
  it("answers an unknown API path with a JSON 404, never the document", async () => {
    const app = await appWithClient();
    try {
      const answers = await Promise.all(["/api/no-such-route", "/api/machines/local/no-such-route"].map(async (url) => {
        const response = await app.inject({ method: "GET", url });
        return { url, status: response.statusCode, json: response.headers["content-type"]?.includes("application/json") === true };
      }));
      const posted = await app.inject({ method: "POST", url: "/api/no-such-route", payload: {} });

      expect({ answers, posted: posted.statusCode }).toEqual({
        answers: [
          { url: "/api/no-such-route", status: 404, json: true },
          { url: "/api/machines/local/no-such-route", status: 404, json: true },
        ],
        posted: 404,
      });
    } finally {
      await app.close();
    }
  });

  it("still serves the document for an application route", async () => {
    // The fallback exists for client-side routing and must keep working.
    const app = await appWithClient();
    try {
      const response = await app.inject({ method: "GET", url: "/projects/some/deep/route" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
    } finally {
      await app.close();
    }
  });

  it("tells the browser never to cache the document", async () => {
    // index.html is the one file whose name never changes, so a cached copy is
    // how an upgrade fails to reach someone.
    const app = await appWithClient();
    try {
      const response = await app.inject({ method: "GET", url: "/index.html" });

      expect(response.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });

  it("lets hashed assets be cached forever", async () => {
    const app = await appWithClient();
    try {
      const response = await app.inject({ method: "GET", url: "/assets/index-CURRENT.js" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toContain("immutable");
    } finally {
      await app.close();
    }
  });
});

const ACCESS_TOKEN = "test-access-token-0123456789abcdefghijklmn";
const ACCESS_PORT = 8504;
/** `inject` sends `Host: localhost:80`, and the cookie is named for the port the browser reached. */
const ACCESS_COOKIE = "pi-web-access-80";
const DAY_MS = 24 * 60 * 60 * 1000;

/** A daemon that answers every request and has no sockets; what the gate protects is not its subject. */
const quietDaemon: SessionProxyDaemon = {
  request: () => Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json" }, body: "{}" }),
  connectWebSocket: () => { throw new Error("no session daemon in this test"); },
};

async function gatedApp(clock: { now: number } = { now: Date.UTC(2026, 9, 21) }, tokens: readonly string[] = [ACCESS_TOKEN]) {
  return buildApp({
    config: emptyConfigService(),
    clientDist: await clientDistWithAssets(),
    logger: false,
    serverPluginRuntime: await noServerPlugins(),
    sessionDaemon: quietDaemon,
    piWebPlugins: {
      manifest: () => Promise.resolve({ lifecycleVersion: 1, plugins: [] }),
      plugins: () => Promise.reject(new Error("no plugin list in this test")),
      readAsset: () => Promise.resolve(undefined),
    },
    access: { tokens, listenPort: ACCESS_PORT, now: () => clock.now },
  });
}

function setCookieOf(headers: Record<string, unknown>): string {
  const value = headers["set-cookie"];
  return typeof value === "string" ? value : Array.isArray(value) ? value.map(String).join("\n") : "";
}

function cookieValueOf(setCookie: string): string {
  return /^pi-web-access-\d+=([^;]*)/u.exec(setCookie)?.[1] ?? "";
}

/**
 * The access gate over a real app (owner, 2026-10-21: one case per route class). A route
 * registered later without the gate is the regression this table catches; every non-exempt class
 * is asked once without a credential and once with each kind of credential.
 */
describe("access gate", () => {
  type Answer = number | "socket-open";
  interface RouteClassRow {
    readonly routeClass: string;
    readonly request: InjectOptions | { readonly socket: string };
    readonly refused: Answer;
    readonly admitted: Answer;
    /** What a token header gets where only the cookie is judged (document reads); `admitted` when absent. */
    readonly byToken?: Answer;
  }

  const rows: readonly RouteClassRow[] = [
    { routeClass: "sign-in page", request: { method: "GET", url: "/access" }, refused: 200, admitted: 200 },
    { routeClass: "PWA metadata", request: { method: "GET", url: "/manifest.webmanifest" }, refused: 200, admitted: 200 },
    { routeClass: "missing PWA file, never the document", request: { method: "GET", url: "/pwa-icon-192.png" }, refused: 404, admitted: 404 },
    { routeClass: "CORS preflight for a route no origin hook answers", request: { method: "OPTIONS", url: "/api/sessions/s1/messages", headers: { origin: "https://other.example", "access-control-request-method": "GET" } }, refused: 404, admitted: 200 },
    { routeClass: "app document, judged by the cookie only", request: { method: "GET", url: "/projects/p1?machine-access=r1" }, refused: 303, admitted: 200, byToken: 303 },
    { routeClass: "built asset", request: { method: "GET", url: "/assets/index-CURRENT.js" }, refused: 401, admitted: 200 },
    { routeClass: "JSON API", request: { method: "GET", url: "/api/pi-web/runtime" }, refused: 401, admitted: 200 },
    { routeClass: "local machine API", request: { method: "GET", url: "/api/machines/local/sessiond/health" }, refused: 401, admitted: 200 },
    { routeClass: "machine access requests", request: { method: "POST", url: "/api/machine-access/requests", headers: { origin: "https://other.example", "sec-fetch-site": "cross-site" }, payload: { name: "Other" } }, refused: 401, admitted: 201 },
    { routeClass: "plugin assets", request: { method: "GET", url: "/pi-web-plugins/manifest.json" }, refused: 401, admitted: 200 },
    { routeClass: "WebSocket upgrade", request: { socket: "/api/events" }, refused: 401, admitted: "socket-open" },
    { routeClass: "unknown API path", request: { method: "GET", url: "/api/no-such-route" }, refused: 401, admitted: 404 },
    { routeClass: "unknown asset path", request: { method: "GET", url: "/assets/gone.js" }, refused: 401, admitted: 404 },
  ];

  it("lets only the sign-in page, the PWA metadata and preflights through without a credential", async () => {
    const app = await gatedApp();
    try {
      const signIn = await app.inject({ method: "POST", url: "/access", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: `token=${ACCESS_TOKEN}` });
      const cookie = `${ACCESS_COOKIE}=${cookieValueOf(setCookieOf(signIn.headers))}`;
      const credentials: Record<string, Record<string, string>> = {
        none: {},
        bearer: { authorization: `Bearer ${ACCESS_TOKEN}` },
        header: { "x-pi-web-access-token": ACCESS_TOKEN },
        cookie: { cookie },
      };
      const ask = async (request: RouteClassRow["request"], headers: Record<string, string>): Promise<Answer> => {
        if ("socket" in request) {
          return app.injectWS(request.socket, { headers: { host: "localhost:80", ...headers } }).then((socket): Answer => { socket.terminate(); return "socket-open"; }, (error: unknown): Answer => Number(/\d{3}/u.exec(String(error))?.[0]));
        }
        return (await app.inject({ ...request, headers: { ...request.headers, ...headers } })).statusCode;
      };
      const answers = [];
      for (const row of rows) {
        const answer: Record<string, Answer> = {};
        for (const [name, headers] of Object.entries(credentials)) answer[name] = await ask(row.request, headers);
        answers.push({ routeClass: row.routeClass, ...answer });
      }

      expect(answers).toEqual(rows.map((row) => ({ routeClass: row.routeClass, none: row.refused, bearer: row.byToken ?? row.admitted, header: row.byToken ?? row.admitted, cookie: row.admitted })));
    } finally {
      await app.close();
    }
  });

  it("mints a 30-day cookie on sign-in, renews it on the base document, ends it on rotation, expiry and tampering, and clears it in the browser on sign-out", async () => {
    const clock = { now: Date.UTC(2026, 9, 21) };
    const app = await gatedApp(clock);
    const rotated = await gatedApp(clock, ["rotated-access-token-0123456789abcdefghij"]);
    try {
      const form = { "content-type": "application/x-www-form-urlencoded" };
      const wrong = await app.inject({ method: "POST", url: "/access", headers: form, payload: "token=not-the-token" });
      const signIn = await app.inject({ method: "POST", url: "/access", headers: { ...form, "x-forwarded-proto": "https" }, payload: `token=${encodeURIComponent(ACCESS_TOKEN)}&next=machine-access%3Dr1` });
      const minted = setCookieOf(signIn.headers);
      const cookie = `${ACCESS_COOKIE}=${cookieValueOf(minted)}`;
      const status = async (target: typeof app, url: string, cookieHeader: string) => (await target.inject({ method: "GET", url, headers: { cookie: cookieHeader } })).statusCode;
      const runtime = await app.inject({ method: "GET", url: "/api/pi-web/runtime", headers: { cookie } });

      const notRenewedSameDay = setCookieOf((await app.inject({ method: "GET", url: "/", headers: { cookie } })).headers);
      clock.now += 2 * DAY_MS;
      const renewedOnBase = setCookieOf((await app.inject({ method: "GET", url: "/", headers: { cookie } })).headers);
      const renewedOnHead = setCookieOf((await app.inject({ method: "HEAD", url: "/", headers: { cookie } })).headers);
      const notRenewedOnApi = setCookieOf((await app.inject({ method: "GET", url: "/api/no-such-route", headers: { cookie } })).headers);
      const tampered = cookie.replace(/.$/u, (last) => (last === "A" ? "B" : "A"));
      const signInAt = async (host: string) => setCookieOf((await app.inject({ method: "POST", url: "/access", headers: { ...form, host }, payload: `token=${encodeURIComponent(ACCESS_TOKEN)}` })).headers);
      const onPort9001 = await signInAt("pi.example:9001");
      const namedFor = { hostPort: onPort9001.split("=", 1)[0], noHostPort: (await signInAt("pi.example")).split("=", 1)[0] };
      const movedToAnotherPort = (await app.inject({ method: "GET", url: "/api/no-such-route", headers: { host: "pi.example:9002", cookie: `pi-web-access-9002=${cookieValueOf(onPort9001)}` } })).statusCode;
      const signOut = await app.inject({ method: "POST", url: "/access", headers: { ...form, cookie }, payload: "intent=sign-out" });
      const afterTwoDays = { valid: await status(app, "/api/no-such-route", cookie), tampered: await status(app, "/api/no-such-route", tampered), rotated: await status(rotated, "/api/no-such-route", cookie) };
      clock.now += 29 * DAY_MS;
      const expired = await status(app, "/api/no-such-route", cookie);

      expect({
        wrong: { status: wrong.statusCode, says: wrong.body.includes("That access token is not right."), setCookie: setCookieOf(wrong.headers) },
        signIn: { status: signIn.statusCode, location: signIn.headers.location },
        minted: minted.replace(/=[^;]*/u, "=<value>"),
        capability: runtime.json<{ components: { web: { capabilities: string[] } } }>().components.web.capabilities.includes("access-token"),
        renewedOnBase: renewedOnBase.startsWith(`${ACCESS_COOKIE}=`) && cookieValueOf(renewedOnBase) !== cookieValueOf(minted),
        notRenewedSameDay,
        renewedOnHead: renewedOnHead.startsWith(`${ACCESS_COOKIE}=`),
        notRenewedOnApi,
        signOut: { status: signOut.statusCode, setCookie: setCookieOf(signOut.headers) },
        namedFor,
        movedToAnotherPort,
        afterTwoDays,
        expired,
      }).toEqual({
        wrong: { status: 401, says: true, setCookie: "" },
        signIn: { status: 303, location: "./?machine-access=r1" },
        minted: `${ACCESS_COOKIE}=<value>; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure`,
        capability: true,
        renewedOnBase: true,
        notRenewedSameDay: "",
        renewedOnHead: true,
        notRenewedOnApi: "",
        signOut: { status: 303, setCookie: `${ACCESS_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Lax` },
        namedFor: { hostPort: "pi-web-access-9001", noHostPort: "pi-web-access-8504" },
        movedToAnotherPort: 401,
        afterTwoDays: { valid: 404, tampered: 401, rotated: 401 },
        expired: 401,
      });
    } finally {
      await app.close();
      await rotated.close();
    }
  });

  /**
   * Review 2026-10-21, P1-1 and P2-6: one address adds at most its own 20 failures to the global
   * ceiling, so it cannot lock out everyone else; and an exempt request's credentials are not
   * evaluated, so a header an authenticating proxy injects cannot throttle the sign-in page.
   */
  it("keeps one address from locking everyone out, and never counts what the sign-in page and the PWA files carry", async () => {
    const app = await gatedApp();
    try {
      const form = { "content-type": "application/x-www-form-urlencoded" };
      const from = (remoteAddress: string, request: InjectOptions) => app.inject({ ...request, remoteAddress });
      for (let attempt = 0; attempt < 250; attempt += 1) {
        await from("10.0.0.1", { method: "GET", url: "/api/no-such-route", headers: { cookie: `${ACCESS_COOKIE}=malformed` } });
      }
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await from("10.0.0.3", { method: "GET", url: attempt % 2 === 0 ? "/access" : "/manifest.webmanifest", headers: { authorization: "Bearer injected-by-a-proxy" } });
      }
      const status = async (remoteAddress: string, request: InjectOptions) => (await from(remoteAddress, request)).statusCode;
      const bearer = { method: "GET", url: "/api/no-such-route", headers: { authorization: `Bearer ${ACCESS_TOKEN}` } } satisfies InjectOptions;
      const signIn = { method: "POST", url: "/access", headers: form, payload: `token=${encodeURIComponent(ACCESS_TOKEN)}` } satisfies InjectOptions;

      expect({
        forgingAddressBearer: await status("10.0.0.1", bearer),
        otherAddressBearer: await status("10.0.0.2", bearer),
        otherAddressSignIn: await status("10.0.0.2", signIn),
        proxyHeaderAddressSignIn: await status("10.0.0.3", signIn),
      }).toEqual({ forgingAddressBearer: 429, otherAddressBearer: 404, otherAddressSignIn: 303, proxyHeaderAddressSignIn: 303 });
    } finally {
      await app.close();
    }
  });

  /** Review 2026-10-21, P2-4: an `access` block the gate cannot use refuses to start, like `tls`, and never prints a value. */
  it("refuses an access block without tokenFile or with any other key, naming keys and never values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-access-config-"));
    const tokenFile = join(dir, "tokens");
    await writeFile(tokenFile, `# rotation\n${ACCESS_TOKEN}\n`, "utf8");
    const outcome = async (access: unknown): Promise<string> => {
      const configPath = join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({ access }), "utf8");
      try {
        return `tokens: ${String(accessTokenConfig({ env: { PI_WEB_CONFIG: configPath } })?.tokens.length)}`;
      } catch (error) {
        return error instanceof AccessTokenConfigError ? `refused: ${error.message.replace(configPath, "<config>")}` : `threw ${String(error)}`;
      }
    };

    expect({
      usable: await outcome({ tokenFile }),
      empty: await outcome({}),
      misspelled: await outcome({ tokenfile: tokenFile }),
      inlineToken: await outcome({ tokenFile, token: ACCESS_TOKEN }),
      notAnObject: await outcome("tokens"),
    }).toEqual({
      usable: "tokens: 1",
      empty: "refused: PI WEB config access must be an object with tokenFile: <config>",
      misspelled: "refused: PI WEB config access must be an object with tokenFile: <config>",
      inlineToken: 'refused: PI WEB config access accepts only tokenFile, not "token": <config>',
      notAnObject: "refused: PI WEB config access must be an object with tokenFile: <config>",
    });
  });
});
