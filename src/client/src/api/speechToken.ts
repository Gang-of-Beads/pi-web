import { request } from "./http";

export interface SpeechCredential {
  token: string;
  region: string;
}

/**
 * The account key stays on the server; the browser gets a short-lived token
 * for the streaming socket.
 */
export function requestSpeechToken(): Promise<SpeechCredential> {
  return request<SpeechCredential>("api/speech/token", parseSpeechCredential, { method: "POST" });
}

function parseSpeechCredential(value: unknown): SpeechCredential {
  if (typeof value !== "object" || value === null) throw new Error("The speech token response was not an object.");
  const record: Record<string, unknown> = { ...value };
  const token = record["token"];
  const region = record["region"];
  if (typeof token !== "string" || token === "") throw new Error("The speech token response carried no token.");
  if (typeof region !== "string" || region === "") throw new Error("The speech token response carried no region.");
  return { token, region };
}
