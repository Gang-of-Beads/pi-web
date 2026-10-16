import { describe, expect, it } from "vitest";

import { chooseDictationRoute } from "./dictationRoute";

const streamingConfig = {
  endpoint: "https://example.test/speech",
  language: "zh-CN",
  streaming: { protocol: "azure-speech" as const, url: "wss://example.test/stream" },
};

describe("choosing how a spoken sentence becomes text", () => {
  /**
   * Every piece of the streaming path was built - token, socket, capture,
   * partial results - and none of it was reachable: the microphone button only
   * ever recorded, then uploaded the whole clip. A speaker got nothing on
   * screen until they stopped talking.
   */
  it("streams when the deployment has a socket to stream to", () => {
    expect(chooseDictationRoute(streamingConfig)).toEqual({ kind: "live", socketUrl: "wss://example.test/stream?language=zh-CN" });
  });

  it("records and uploads only when no streaming is configured, with a token when the install names Azure Speech", () => {
    expect(chooseDictationRoute({ endpoint: "http://127.0.0.1:9000/transcribe" })).toEqual({ kind: "whole-clip", authorization: "none" });
    expect(chooseDictationRoute({ endpoint: "https://example.test/speech", authorization: "speech-token" }))
      .toEqual({ kind: "whole-clip", authorization: "speech-token" });
    expect(chooseDictationRoute({ ...streamingConfig, streaming: { protocol: "azure-speech" } }))
      .toEqual({ kind: "refused", reason: "Streaming transcription needs a socket url." });
  });

  it("has nothing to offer when dictation is not configured at all", () => {
    expect(chooseDictationRoute(undefined)).toEqual({ kind: "unconfigured" });
  });
});
