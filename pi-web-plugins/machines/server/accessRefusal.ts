/**
 * A remote PI WEB's access gate refusing the token this server holds for it. The codes are the remote
 * gate's own, read from its JSON answer; any other 401 or 429 (an authenticating proxy) is not a
 * refusal. This server does not stop contacting a machine that refused it: the next request asks
 * again, so a corrected token works without a wait.
 */
export type AccessRefusal = "token-refused" | "throttled";

const REFUSAL_BY_ANSWER: ReadonlyMap<string, AccessRefusal> = new Map([
  ["401 access-required", "token-refused"],
  ["429 access-throttled", "throttled"],
]);

/** The words a machine card uses for a refusal. */
export const ACCESS_REFUSAL_WORDS: Readonly<Record<AccessRefusal, string>> = {
  "token-refused": "This server's access token was refused",
  throttled: "This server's access token attempts are refused for now",
};

export function accessRefusal(statusCode: number, body: unknown): AccessRefusal | undefined {
  const code = typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" ? body.code : "";
  return REFUSAL_BY_ANSWER.get(`${String(statusCode)} ${code}`);
}
