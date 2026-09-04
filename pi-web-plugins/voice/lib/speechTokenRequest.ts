export interface SpeechCredential {
  token: string;
  region: string;
}

export type FetchJson = (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;

/**
 * The account key stays on the server; the browser gets a short-lived token
 * for the streaming socket. The path is handed to the host, which owns the
 * single place an application path becomes an absolute URL.
 */
export function speechTokenRequester(fetchJson: FetchJson): () => Promise<SpeechCredential> {
  return async () => parseSpeechCredential(await fetchJson("api/speech/token", { method: "POST" }));
}

export function parseSpeechCredential(value: unknown): SpeechCredential {
  if (typeof value !== "object" || value === null) throw new Error("The speech token response was not an object.");
  const record: Record<string, unknown> = { ...value };
  const token = record["token"];
  const region = record["region"];
  if (typeof token !== "string" || token === "") throw new Error("The speech token response carried no token.");
  if (typeof region !== "string" || region === "") throw new Error("The speech token response carried no region.");
  return { token, region };
}
