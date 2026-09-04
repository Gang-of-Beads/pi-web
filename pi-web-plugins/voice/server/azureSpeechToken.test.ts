import { describe, expect, it } from "vitest";
import { azureSpeechTokenEndpoint, createAzureSpeechTokenService, parseAzureSpeechSettings, type PiWebAzureSpeechConfig } from "./azureSpeechToken.js";

const config: PiWebAzureSpeechConfig = { region: "swedencentral", resource: "res-1", key: "secret-key" };

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

describe("reading the plugin's credential block", () => {
  it("reads a complete block", () => {
    expect(parseAzureSpeechSettings({ azureSpeech: { region: "swedencentral", resource: "res-1", key: "secret-key" } })).toEqual(config);
  });

  it("treats an absent or incomplete block as unconfigured rather than as broken", () => {
    expect(parseAzureSpeechSettings(undefined)).toBeUndefined();
    expect(parseAzureSpeechSettings({})).toBeUndefined();
    expect(parseAzureSpeechSettings({ azureSpeech: { region: "swedencentral" } })).toBeUndefined();
    expect(parseAzureSpeechSettings({ azureSpeech: { key: "k" } })).toBeUndefined();
    expect(parseAzureSpeechSettings({ azureSpeech: "swedencentral" })).toBeUndefined();
  });

  it("keeps the subscription key out of what it reports about itself", () => {
    const parsed = parseAzureSpeechSettings({ azureSpeech: { region: "swedencentral", key: "secret-key" } });

    expect(parsed?.region).toBe("swedencentral");
    expect(JSON.stringify({ region: parsed?.region, resource: parsed?.resource })).not.toContain("secret-key");
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
