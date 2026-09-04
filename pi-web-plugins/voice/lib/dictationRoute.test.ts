import { describe, expect, it } from "vitest";

import { chooseDictationRoute, DictationRoute } from "./dictationRoute";

const streamingConfig = {
  endpoint: "https://example.test/speech",
  language: "zh-CN",
  streaming: { protocol: "azure-speech" as const, url: "wss://example.test/stream", tokenEndpoint: "api/speech/token" },
};

describe("choosing how a spoken sentence becomes text", () => {
  /**
   * Every piece of the streaming path was built - token, socket, capture,
   * partial results - and none of it was reachable: the microphone button only
   * ever recorded, then uploaded the whole clip. A speaker got nothing on
   * screen until they stopped talking.
   */
  it("streams when the deployment has a socket to stream to", () => {
    expect(chooseDictationRoute(streamingConfig)).toBe(DictationRoute.live);
  });

  it("records and uploads when there is no socket", () => {
    expect(chooseDictationRoute({ endpoint: "https://example.test/speech" })).toBe(DictationRoute.wholeClip);
  });

  it("has nothing to offer when dictation is not configured at all", () => {
    expect(chooseDictationRoute(undefined)).toBe(DictationRoute.unavailable);
  });
});
