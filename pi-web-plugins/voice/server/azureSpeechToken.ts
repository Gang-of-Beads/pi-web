import type { JsonObject } from "@gang-of-beads/pi-web/server-plugin-api";

export interface PiWebAzureSpeechConfig {
  region: string;
  resource?: string;
  key: string;
}

/**
 * Handing the browser a credential it can dictate with.
 *
 * Live transcription connects from the page straight to Azure, because putting
 * this server in the audio path would add a hop to every syllable for nothing.
 * That means the page needs a credential - but not the subscription key, which
 * could be used for anything and would be readable by anyone who opened the
 * developer tools. Azure issues a ten-minute token for exactly this, so the key
 * stays here and the page gets something that expires.
 *
 * The token is bound to the host that issued it, so the endpoint is derived
 * from the same config the socket url is, rather than being configured twice
 * and drifting.
 */
export interface AzureSpeechTokenService {
  issue: (config: PiWebAzureSpeechConfig) => Promise<string>;
}

export function azureSpeechTokenEndpoint(config: PiWebAzureSpeechConfig): string {
  // The custom-subdomain endpoint is preferred: a token from it is accepted by
  // the resource's own hosts. The regional endpoint is the fallback for a
  // resource that has no custom subdomain.
  return config.resource === undefined || config.resource === ""
    ? `https://${config.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`
    : `https://${config.resource}.cognitiveservices.azure.com/sts/v1.0/issueToken`;
}

export function createAzureSpeechTokenService(
  fetchImpl: typeof fetch = fetch,
): AzureSpeechTokenService {
  return {
    issue: async (config) => {
      const response = await fetchImpl(azureSpeechTokenEndpoint(config), {
        method: "POST",
        headers: { "Ocp-Apim-Subscription-Key": config.key, "Content-Length": "0" },
      });
      if (!response.ok) {
        // The status is reported without the body: an error page from an
        // authentication endpoint is not something to forward to a browser.
        throw new Error(`Azure Speech token request failed with status ${String(response.status)}`);
      }
      return await response.text();
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Where this machine's Azure Speech key comes from.
 *
 * The key belongs in the private `serverSettings` block, which no browser
 * receives. A key still in the public `settings` block keeps working, so an
 * upgrade breaks nothing, but it is readable by every browser that opens PI
 * WEB and is reported as such. A host that passes no `serverSettings` at all
 * is older than private settings; that is said rather than reported as "no key
 * configured". Region and resource are public: they name the service, not a
 * credential.
 */
export type AzureSpeechKeySource =
  | { kind: "server-settings" | "server-settings-and-public-copy" | "public-settings" | "public-settings-on-older-host"; config: PiWebAzureSpeechConfig }
  | { kind: "no-region" | "no-key" | "no-key-older-host" };

export function resolveAzureSpeechKey(settings: JsonObject, serverSettings: JsonObject | undefined): AzureSpeechKeySource {
  const publicValue = settings["azureSpeech"];
  const privateValue = serverSettings?.["azureSpeech"];
  const publicBlock = isRecord(publicValue) ? publicValue : undefined;
  const privateBlock = isRecord(privateValue) ? privateValue : undefined;
  const region = nonEmptyString(publicBlock, "region");
  if (region === undefined) return { kind: "no-region" };
  const resource = publicBlock?.["resource"];
  const service = { region, ...(typeof resource === "string" ? { resource } : {}) };
  const privateKey = nonEmptyString(privateBlock, "key");
  const publicKey = nonEmptyString(publicBlock, "key");
  if (privateKey !== undefined) {
    return { kind: publicKey === undefined ? "server-settings" : "server-settings-and-public-copy", config: { ...service, key: privateKey } };
  }
  if (publicKey !== undefined) {
    return { kind: serverSettings === undefined ? "public-settings-on-older-host" : "public-settings", config: { ...service, key: publicKey } };
  }
  return { kind: serverSettings === undefined ? "no-key-older-host" : "no-key" };
}
