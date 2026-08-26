import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { azureSpeechTokenEndpoint, createAzureSpeechTokenService, registerSpeechRoutes } from "./speechRoutes.js";
import type { PiWebAzureSpeechConfig } from "../shared/apiTypes.js";

const config: PiWebAzureSpeechConfig = { region: "swedencentral", resource: "res-1", key: "secret-key" };

/** A server with the speech routes on it, closed by the caller. */
async function serverWith(
  readConfig: () => PiWebAzureSpeechConfig | undefined,
  issue: () => Promise<string>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerSpeechRoutes(app, readConfig, { issue });
  await app.ready();
  return app;
}

describe("where a token is asked for", () => {
  /**
   * A token is only accepted by the host that issued it, so the endpoint is
   * derived from the same config the socket url is rather than configured
   * separately and left to drift.
   */
  it("uses the resource's own subdomain when it has one", () => {
    expect(azureSpeechTokenEndpoint(config))
      .toBe("https://res-1.cognitiveservices.azure.com/sts/v1.0/issueToken");
  });

  it("falls back to the regional endpoint when there is no custom subdomain", () => {
    expect(azureSpeechTokenEndpoint({ region: "swedencentral", key: "k" }))
      .toBe("https://swedencentral.api.cognitive.microsoft.com/sts/v1.0/issueToken");
  });
});

describe("issuing a token to the browser", () => {

  it("hands back a token and the region it belongs to, never the key", async () => {
    const app = await serverWith(() => config, () => Promise.resolve("jwt-token"));
    const response = await app.inject({ method: "POST", url: "/api/speech/token" });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ token: string; region: string }>();
    expect(body.token).toBe("jwt-token");
    expect(body.region).toBe("swedencentral");
    // The whole point of the exchange: the subscription key must not travel.
    expect(response.body).not.toContain("secret-key");
    await app.close();
  });

  it("says live transcription is not configured rather than failing obscurely", async () => {
    const app = await serverWith(() => undefined, () => Promise.resolve("unused"));
    const response = await app.inject({ method: "POST", url: "/api/speech/token" });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("reports an upstream refusal without forwarding its body", async () => {
    const app = await serverWith(() => config, () => Promise.reject(new Error("status 401")));
    const response = await app.inject({ method: "POST", url: "/api/speech/token" });

    expect(response.statusCode).toBe(502);
    expect(response.json<{ error: string }>().error).toContain("401");
    await app.close();
  });
});

describe("the exchange with azure", () => {

  it("sends the key as a subscription header and returns the body verbatim", async () => {
    const seen: { url: string; key: string; method: string }[] = [];
    const fetchMock = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
        key: headers.get("Ocp-Apim-Subscription-Key") ?? "",
        method: init?.method ?? "GET",
      });
      return Promise.resolve(new Response("jwt", { status: 200 }));
    };

    const token = await createAzureSpeechTokenService(fetchMock).issue(config);

    expect(token).toBe("jwt");
    expect(seen).toEqual([{
      url: "https://res-1.cognitiveservices.azure.com/sts/v1.0/issueToken",
      key: "secret-key",
      method: "POST",
    }]);
  });

  it("reports the status but not the body of a refusal", async () => {
    // An error page from an authentication endpoint is not something to
    // forward to a browser.
    const fetchMock = (): Promise<Response> =>
      Promise.resolve(new Response("<html>denied</html>", { status: 403 }));

    await expect(createAzureSpeechTokenService(fetchMock).issue(config)).rejects.toThrow(/403/u);
    await expect(createAzureSpeechTokenService(fetchMock).issue(config)).rejects.not.toThrow(/denied/u);
  });
});
