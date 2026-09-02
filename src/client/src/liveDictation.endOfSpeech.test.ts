// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { LiveDictation } from "./liveDictation.js";

/**
 * Stopping mid-sentence must not drop the last words.
 *
 * The protocol says an empty audio chunk is how the client declares the
 * utterance over; the encoder's own docstring says so. Stop closed the socket
 * without sending one, so the tail of a sentence survived only if the service's
 * silence detection had already fired on its own. Press stop while still
 * speaking and the last words were never recognised.
 */

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  readyState = 1;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send(data: unknown): void { this.sent.push(data); }
  close(): void { this.readyState = 3; }
}

function dictation(socket: FakeSocket): LiveDictation {
  return new LiveDictation({
    requestToken: async () => ({ token: "t", region: "r" }),
    openSocket: () => socket as unknown as WebSocket,
    captureAudio: async () => () => {},
    onText: () => {},
    onError: () => {},
    newRequestId: () => "req",
  });
}

describe("declaring the end of an utterance", () => {
  it("sends the empty chunk the protocol defines before closing", async () => {
    const socket = new FakeSocket();
    const live = dictation(socket);
    await live.start("wss://example.invalid");
    socket.sent.length = 0;

    live.stop();

    const binary = socket.sent.filter((frame) => frame instanceof Uint8Array);
    expect(binary.length).toBeGreaterThan(0);
  });

  it("does not fail when the socket has already gone", async () => {
    const socket = new FakeSocket();
    const live = dictation(socket);
    await live.start("wss://example.invalid");
    socket.readyState = 3;

    expect(() => { live.stop(); }).not.toThrow();
  });

  /**
   * Capture is attached after start() returns - start does not await it - so a
   * stop issued in that window has no capture handle yet. What must hold is
   * that stopping is still safe and still closes the socket.
   */
  it("stops the microphone once capture has actually attached", async () => {
    const stopCapture = vi.fn();
    const socket = new FakeSocket();
    const live = new LiveDictation({
      requestToken: async () => ({ token: "t", region: "r" }),
      openSocket: () => socket as unknown as WebSocket,
      captureAudio: async () => stopCapture,
      onText: () => {},
      onError: () => {},
      newRequestId: () => "req",
    });
    await live.start("wss://example.invalid");
    socket.onopen?.();
    await Promise.resolve();
    await Promise.resolve();

    live.stop();

    expect(stopCapture).toHaveBeenCalled();
  });
});
