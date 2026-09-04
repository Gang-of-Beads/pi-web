export interface SpeechCredential {
  token: string;
  region: string;
}

export type CallOperation = (operation: string, input?: unknown) => Promise<unknown>;

/**
 * The account key stays on the server; the browser gets a short-lived token
 * for the streaming socket. The token is minted by this plugin's own daemon
 * operation, and the path is built by the host, which owns the single place an
 * application path becomes an absolute URL.
 *
 * An unconfigured install answers that it is unconfigured rather than a
 * credential, and dictation reports that instead of failing obscurely.
 */
export function speechTokenRequester(callOperation: CallOperation): () => Promise<SpeechCredential> {
  return async () => parseSpeechCredential(await callOperation("speech.token"));
}

export function parseSpeechCredential(value: unknown): SpeechCredential {
  if (typeof value !== "object" || value === null) throw new Error("The speech token response was not an object.");
  const record: Record<string, unknown> = { ...value };
  if (record["configured"] === false) throw new Error("Live transcription is not configured on this machine.");
  const token = record["token"];
  const region = record["region"];
  if (typeof token !== "string" || token === "") throw new Error("The speech token response carried no token.");
  if (typeof region !== "string" || region === "") throw new Error("The speech token response carried no region.");
  return { token, region };
}
