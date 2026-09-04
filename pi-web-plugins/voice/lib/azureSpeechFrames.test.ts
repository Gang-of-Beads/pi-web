import { describe, expect, it } from "vitest";
import { decodeAzureFrame, encodeAzureTextFrame } from "./azureSpeechFrames";

/**
 * Azure's socket does not carry bare JSON. Every message is a text frame of
 * `Header: value` lines, a blank line, then the body - the same shape as an
 * HTTP message - and the header that matters is `Path`, which names what the
 * body is. A decoder that assumes JSON sees a parse error on every frame and
 * reports a broken socket for a service that is working perfectly.
 */
describe("decoding a frame", () => {
  it("reads the path and the json body", () => {
    const frame = "X-RequestId:abc\r\nPath:speech.hypothesis\r\nContent-Type:application/json\r\n\r\n{\"Text\":\"hello\"}";

    expect(decodeAzureFrame(frame)).toEqual({ path: "speech.hypothesis", body: { Text: "hello" } });
  });

  it("reads a frame whose body is not json", () => {
    // turn.start carries an empty or non-JSON body; it is still a frame worth
    // recognising rather than an error.
    expect(decodeAzureFrame("Path:turn.start\r\n\r\n")).toEqual({ path: "turn.start", body: undefined });
  });

  it("tolerates bare newlines as well as carriage returns", () => {
    expect(decodeAzureFrame("Path:turn.end\n\n")?.path).toBe("turn.end");
  });

  it("has nothing to say about a frame with no path", () => {
    expect(decodeAzureFrame("Content-Type:application/json\r\n\r\n{}")).toBeUndefined();
  });

  it("has nothing to say about an empty frame", () => {
    expect(decodeAzureFrame("")).toBeUndefined();
  });
});

describe("encoding a frame", () => {
  it("writes the headers, a blank line, then the body", () => {
    const frame = encodeAzureTextFrame("speech.config", "req-1", { context: {} });

    expect(frame).toContain("Path:speech.config");
    expect(frame).toContain("X-RequestId:req-1");
    expect(frame).toContain("Content-Type:application/json");
    // The blank line is what separates headers from body; without it the whole
    // frame is read as headers and the body is silently lost.
    expect(frame).toContain("\r\n\r\n");
    expect(frame.endsWith("{\"context\":{}}")).toBe(true);
  });

  it("stamps a timestamp, which the service requires on every frame", () => {
    expect(encodeAzureTextFrame("speech.config", "req-1", {})).toContain("X-Timestamp:");
  });
});
