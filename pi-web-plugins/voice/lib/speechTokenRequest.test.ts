import { describe, expect, it } from "vitest";
import { parseSpeechCredential, speechTokenRequester } from "./speechTokenRequest.js";

describe("asking this plugin's daemon half for a token", () => {
  it("calls the plugin's own declared operation, under its runtime id", async () => {
    const seen: { path: string; method: string | undefined }[] = [];

    await speechTokenRequester((path, init) => {
      seen.push({ path, method: init?.method });
      return Promise.resolve({ configured: true, token: "jwt", region: "swedencentral" });
    }, "machine.remote.voice")();

    expect(seen).toEqual([{ path: "api/plugins/machine.remote.voice/speech.token", method: "POST" }]);
  });

  it("returns the credential without the key that minted it", async () => {
    const credential = await speechTokenRequester(() => Promise.resolve({ configured: true, token: "jwt", region: "swedencentral" }))();

    expect(credential).toEqual({ token: "jwt", region: "swedencentral" });
  });

  it("says the feature is unconfigured rather than failing obscurely", () => {
    expect(() => parseSpeechCredential({ configured: false })).toThrow(/not configured/iu);
  });

  it("refuses an answer carrying no token", () => {
    expect(() => parseSpeechCredential({ configured: true, region: "swedencentral" })).toThrow(/token/iu);
    expect(() => parseSpeechCredential({ configured: true, token: "jwt" })).toThrow(/region/iu);
  });
});
