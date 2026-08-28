// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { LiveDictation } from "./liveDictation";

/**
 * Sequencing a live dictation: token first, then socket, then microphone.
 *
 * The order matters. Opening the microphone before there is anywhere to send
 * the audio makes a browser ask for permission it may not end up using, and
 * sending audio before the service has been configured has it rejected.
 */
describe("starting a dictation", () => {
  it("asks for a token before opening the socket", async () => {
    const order: string[] = [];
    const socket = new FakeSocket();
    await new LiveDictation({
      requestToken: () => { order.push("token"); return Promise.resolve({ token: "t", region: "swedencentral" }); },
      openSocket: () => { order.push("socket"); return socket.asWebSocket(); },
      captureAudio: () => { order.push("mic"); return Promise.resolve(() => undefined); },
      onText: () => undefined,
      onError: () => undefined,
      newRequestId: () => "req-1",
    }).start("wss://example/stt");

    expect(order).toEqual(["token", "socket"]);
  });

  it("carries the token in the url, because a browser cannot set a socket header", async () => {
    let opened = "";
    const socket = new FakeSocket();
    await new LiveDictation(deps({ openSocket: (url) => { opened = url; return socket.asWebSocket(); } }))
      .start("wss://example/stt");

    expect(opened).toContain("Authorization=Bearer+token-1");
  });

  it("does not open a socket when no token could be had", async () => {
    const openSocket = vi.fn();
    const onError = vi.fn();
    await new LiveDictation(deps({
      requestToken: () => Promise.reject(new Error("401")),
      openSocket,
      onError,
    })).start("wss://example/stt");

    expect(openSocket).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("401"));
  });

  it("only opens the microphone once the socket is up", async () => {
    const order: string[] = [];
    const socket = new FakeSocket();
    await new LiveDictation(deps({
      openSocket: () => { order.push("socket"); return socket.asWebSocket(); },
      captureAudio: () => { order.push("mic"); return Promise.resolve(() => undefined); },
    })).start("wss://example/stt");

    expect(order).toEqual(["socket"]);
    socket.open();
    await Promise.resolve();
    expect(order).toEqual(["socket", "mic"]);
  });
});

describe("text arriving", () => {
  it("shows a hypothesis while it is still forming", async () => {
    const onText = vi.fn();
    const socket = new FakeSocket();
    await new LiveDictation(deps({ openSocket: () => socket.asWebSocket(), onText })).start("wss://example/stt");

    socket.receive("Path:speech.hypothesis\r\n\r\n{\"Text\":\"hello\"}");

    expect(onText).toHaveBeenCalledWith("hello");
  });

  it("replaces the guess rather than stacking guesses up", async () => {
    const seen: string[] = [];
    const socket = new FakeSocket();
    await new LiveDictation(deps({ openSocket: () => socket.asWebSocket(), onText: (t) => seen.push(t) }))
      .start("wss://example/stt");

    socket.receive("Path:speech.hypothesis\r\n\r\n{\"Text\":\"hello\"}");
    socket.receive("Path:speech.hypothesis\r\n\r\n{\"Text\":\"hello there\"}");

    expect(seen.at(-1)).toBe("hello there");
  });

  it("keeps only settled text when the speaker stops", async () => {
    const seen: string[] = [];
    const socket = new FakeSocket();
    const dictation = new LiveDictation(deps({ openSocket: () => socket.asWebSocket(), onText: (t) => seen.push(t) }));
    await dictation.start("wss://example/stt");

    socket.receive("Path:speech.phrase\r\n\r\n{\"RecognitionStatus\":\"Success\",\"DisplayText\":\"hello there.\"}");
    socket.receive("Path:speech.hypothesis\r\n\r\n{\"Text\":\"half a th\"}");
    dictation.stop();

    // The trailing guess is dropped: it is not something the speaker said.
    expect(seen.at(-1)).toBe("hello there.");
  });

  it("reports an error frame instead of treating it as text", async () => {
    const onError = vi.fn();
    const socket = new FakeSocket();
    await new LiveDictation(deps({ openSocket: () => socket.asWebSocket(), onError })).start("wss://example/stt");

    socket.receive("Path:speech.phrase\r\n\r\n{\"RecognitionStatus\":\"Error\",\"DisplayText\":\"\"}");

    expect(onError).toHaveBeenCalled();
  });
});

/**
 * A socket that fails while it is closing still has the handler attached, so a
 * dictation the user already finished can put an error on screen afterwards -
 * next to a composer they are no longer dictating into.
 */
describe("a dictation that has been stopped", () => {
  it("reports nothing when its socket fails after the stop", async () => {
    const onError = vi.fn();
    const socket = new FakeSocket();
    const dictation = new LiveDictation(deps({ openSocket: () => socket.asWebSocket(), onError }));
    await dictation.start("wss://example/stt");

    dictation.stop();
    socket.fail();

    expect(onError).not.toHaveBeenCalled();
  });

  it("closes a socket that was still connecting when the user stopped", async () => {
    const socket = new FakeSocket();
    const dictation = new LiveDictation(deps({ openSocket: () => socket.asWebSocket() }));
    await dictation.start("wss://example/stt");

    // readyState 0 is CONNECTING: close() is ignored there, so a socket that
    // finishes connecting after the stop would otherwise stay open with a live
    // microphone behind it.
    dictation.stop();
    socket.open();

    expect(socket.readyState).toBe(3);
  });
});

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onopen?: () => void;
  onerror?: () => void;

  asWebSocket(): WebSocket {
    const readyStateOf = (): number => this.readyState;
    const record = (payload: string): void => { this.sent.push(payload); };
    const markClosed = (): void => { this.readyState = 3; };
    const stub = {
      get readyState() { return readyStateOf(); },
      send: record,
      close: markClosed,
      set onmessage(handler: (event: { data: unknown }) => void) { setMessage(handler); },
      set onopen(handler: () => void) { setOpen(handler); },
      set onerror(handler: () => void) { setError(handler); },
    };
    const setMessage = (handler: (event: { data: unknown }) => void): void => { this.onmessage = handler; };
    const setOpen = (handler: () => void): void => { this.onopen = handler; };
    const setError = (handler: () => void): void => { this.onerror = handler; };
    const asUnknown: unknown = stub;
    if (!isWebSocketLike(asUnknown)) throw new Error("fake socket does not satisfy the shape used");
    return asUnknown;
  }

  open(): void { this.readyState = 1; this.onopen?.(); }
  receive(frame: string): void { this.onmessage?.({ data: frame }); }
  fail(): void { this.onerror?.(); }
}

function isWebSocketLike(value: unknown): value is WebSocket {
  return typeof value === "object" && value !== null && "send" in value && "close" in value;
}

function deps(overrides: Partial<ConstructorParameters<typeof LiveDictation>[0]> = {}): ConstructorParameters<typeof LiveDictation>[0] {
  return {
    requestToken: () => Promise.resolve({ token: "token-1", region: "swedencentral" }),
    openSocket: () => new FakeSocket().asWebSocket(),
    captureAudio: () => Promise.resolve(() => undefined),
    onText: () => undefined,
    onError: () => undefined,
    newRequestId: () => "req-1",
    ...overrides,
  };
}
