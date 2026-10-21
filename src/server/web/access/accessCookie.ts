import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The access gate's credentials: the configured tokens and the sign-in cookie they sign.
 *
 * A token is compared by its SHA-256 against every configured token's, in constant time and without
 * stopping at the first match, so neither the time taken nor the order of the tokens says anything.
 *
 * The cookie is `v1.<keyId>.<issuedAt>.<mac>`: `key = HMAC-SHA256(token, "pi-web access cookie v1")`,
 * `keyId` a short hash of the key, `mac = HMAC(key, name + payload)`, keyed by the token the browser
 * signed in with. It names the port the browser reached (cookies ignore ports, so two instances on one
 * host would overwrite each other's; see `accessCookieName`) and expires 30 days after it was issued;
 * a base-level read renews it once a day (`COOKIE_RENEW_AFTER_SECONDS`), which the app asks for while
 * it is in use, so only 30 idle days end it. Removing a token removes its key, which ends every cookie it signed. There is no server-side
 * session store: a stolen cookie is revoked by rotating the token.
 */

export const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const COOKIE_RENEW_AFTER_SECONDS = 24 * 60 * 60;
const COOKIE_FUTURE_SKEW_SECONDS = 5 * 60;
const COOKIE_VERSION = "v1";
const COOKIE_KEY_LABEL = "pi-web access cookie v1";
const KEY_ID_LENGTH = 12;

/**
 * What a presented cookie came to. `malformed` and `forged` count as failed attempts; a cookie under a
 * removed token (`unknown-key`) or one past its age (`expired`) is what every signed-out browser holds
 * after a rotation or a month away, and counting those would lock them out of the sign-in page.
 */
export type CookieCheck =
  | { readonly kind: "valid"; readonly issuedAt: number; readonly key: CookieKey }
  | { readonly kind: "absent" | "malformed" | "forged" | "unknown-key" | "expired" };

/** One token's cookie key; a cookie is signed with the key of the token that signed the browser in. */
export interface CookieKey {
  readonly id: string;
  readonly secret: Buffer;
}

export interface AccessCredentials {
  /** The key of the configured token `presented` equals, or undefined. */
  matchToken(presented: string): CookieKey | undefined;
  mintCookie(cookieName: string, key: CookieKey, nowSeconds: number): string;
  checkCookie(cookieName: string, value: string | undefined, nowSeconds: number): CookieCheck;
  needsRenewal(issuedAt: number, nowSeconds: number): boolean;
}

function sha256(value: string | Buffer): Buffer {
  return createHash("sha256").update(value).digest();
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function cookieKey(token: string): CookieKey {
  const secret = hmac(token, COOKIE_KEY_LABEL);
  return { id: sha256(secret).toString("hex").slice(0, KEY_ID_LENGTH), secret };
}

const MAX_PORT = 65535;

/**
 * The cookie's name, from the port the browser reached: the `Host` header's when it names one, the
 * listen port otherwise (a proxy on the default port). Docker instances all listen on 8504 inside
 * their containers, so the listen port alone would give two of them on one host the same name. A
 * forged `Host` only picks another name; the MAC covers the name, so it cannot borrow a cookie.
 */
export function accessCookieName(hostPort: number | null, listenPort: number): string {
  const port = hostPort !== null && hostPort > 0 && hostPort <= MAX_PORT ? hostPort : listenPort;
  return `pi-web-access-${String(port)}`;
}

export function accessCredentials(tokens: readonly string[]): AccessCredentials {
  const tokenDigests = tokens.map((token) => sha256(token));
  const keys = tokens.map(cookieKey);
  const mac = (cookieName: string, key: CookieKey, payload: string): string => hmac(key.secret, `${cookieName}${payload}`).toString("base64url");

  return {
    matchToken(presented) {
      const digest = sha256(presented);
      let matched: CookieKey | undefined;
      tokenDigests.forEach((expected, index) => {
        if (timingSafeEqual(digest, expected)) matched = keys[index];
      });
      return matched;
    },
    mintCookie(cookieName, key, nowSeconds) {
      const payload = `${COOKIE_VERSION}.${key.id}.${String(Math.floor(nowSeconds))}`;
      return `${payload}.${mac(cookieName, key, payload)}`;
    },
    checkCookie(cookieName, value, nowSeconds) {
      if (value === undefined) return { kind: "absent" };
      const [version, keyId, issued, presentedMac, ...rest] = value.split(".");
      if (version !== COOKIE_VERSION || keyId === undefined || issued === undefined || presentedMac === undefined || rest.length > 0 || !/^\d{1,12}$/u.test(issued)) return { kind: "malformed" };
      const key = keys.find((candidate) => candidate.id === keyId);
      if (key === undefined) return { kind: "unknown-key" };
      const expected = Buffer.from(mac(cookieName, key, `${version}.${keyId}.${issued}`));
      const presented = Buffer.from(presentedMac);
      if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return { kind: "forged" };
      const issuedAt = Number(issued);
      if (issuedAt > nowSeconds + COOKIE_FUTURE_SKEW_SECONDS || nowSeconds - issuedAt >= COOKIE_MAX_AGE_SECONDS) return { kind: "expired" };
      return { kind: "valid", issuedAt, key };
    },
    needsRenewal(issuedAt, nowSeconds) {
      return nowSeconds - issuedAt >= COOKIE_RENEW_AFTER_SECONDS;
    },
  };
}
