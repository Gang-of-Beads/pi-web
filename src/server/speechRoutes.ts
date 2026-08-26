import type { FastifyInstance } from "fastify";
import type { PiWebAzureSpeechConfig } from "../shared/apiTypes.js";

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

export function registerSpeechRoutes(
  app: FastifyInstance,
  readConfig: () => PiWebAzureSpeechConfig | undefined | Promise<PiWebAzureSpeechConfig | undefined>,
  service: AzureSpeechTokenService = createAzureSpeechTokenService(),
): void {
  app.post("/api/speech/token", async (_request, reply) => {
    const config = await readConfig();
    if (config === undefined) {
      return await reply.code(404).send({ error: "Live transcription is not configured." });
    }
    try {
      const token = await service.issue(config);
      // The region travels with the token because the socket host is regional
      // and the browser has no other way to know which one this token is for.
      return await reply.send({ token, region: config.region, expiresInSeconds: 540 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return await reply.code(502).send({ error: message });
    }
  });
}
