// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { startBrowserSpeechStream, isBrowserSpeechAvailable } from "./browserSpeechStream";

/**
 * The browser's own recogniser is the one streaming path that needs nothing
 * configured, so it is what an install can try before choosing a service. It
 * reports results as a growing list where the settled ones stay put and the
 * last one keeps changing, which is neither of the two socket protocols'
 * shapes and has to be translated rather than passed through.
 */
describe("the browser's recogniser", () => {
  it("is unavailable when the browser does not offer one", () => {
    expect(isBrowserSpeechAvailable({})).toBe(false);
  });

  it("is available under either the standard or the webkit name", () => {
    expect(isBrowserSpeechAvailable({ SpeechRecognition: function Recogniser() { /* stub */ } })).toBe(true);
    expect(isBrowserSpeechAvailable({ webkitSpeechRecognition: function Recogniser() { /* stub */ } })).toBe(true);
  });

  it("reports settled results as final and the last one as a guess", () => {
    const recogniser = new FakeRecogniser();
    const events: unknown[] = [];
    startBrowserSpeechStream({
      window: { SpeechRecognition: recogniser.constructorFor() },
      onEvent: (event) => events.push(event),
      onError: () => undefined,
    });

    recogniser.emit([{ transcript: "hello there", isFinal: true }, { transcript: "how are", isFinal: false }]);

    expect(events).toEqual([
      { kind: "final", text: "hello there" },
      { kind: "delta", text: "how are" },
    ]);
  });

  it("asks for interim results, or nothing arrives until the speaker stops", () => {
    const recogniser = new FakeRecogniser();
    startBrowserSpeechStream({
      window: { SpeechRecognition: recogniser.constructorFor() },
      onEvent: () => undefined,
      onError: () => undefined,
    });

    expect(recogniser.instance?.interimResults).toBe(true);
    expect(recogniser.instance?.continuous).toBe(true);
  });

  it("stops the recogniser when the caller stops", () => {
    const recogniser = new FakeRecogniser();
    const handle = startBrowserSpeechStream({
      window: { SpeechRecognition: recogniser.constructorFor() },
      onEvent: () => undefined,
      onError: () => undefined,
    });

    handle.stop();

    expect(recogniser.instance?.stopped).toBe(true);
  });

  it("reports a recogniser error rather than failing silently", () => {
    const recogniser = new FakeRecogniser();
    const onError = vi.fn();
    startBrowserSpeechStream({
      window: { SpeechRecognition: recogniser.constructorFor() },
      onEvent: () => undefined,
      onError,
    });

    recogniser.fail("not-allowed");

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("not-allowed"));
  });
});

class FakeRecogniser {
  instance?: FakeInstance;

  /** A constructor the code under test can `Reflect.construct`. */
  constructorFor(): () => FakeInstance {
    const remember = (instance: FakeInstance): FakeInstance => {
      this.instance = instance;
      return instance;
    };
    function Recogniser(this: unknown): FakeInstance {
      return remember(new FakeInstance());
    }
    return Recogniser;
  }

  emit(results: { transcript: string; isFinal: boolean }[]): void {
    this.instance?.onresult?.({
      resultIndex: 0,
      results: buildResultList(results),
    });
  }

  fail(error: string): void {
    this.instance?.onerror?.({ error });
  }
}

class FakeInstance {
  interimResults = false;
  continuous = false;
  lang = "";
  stopped = false;
  onresult?: (event: { resultIndex: number; results: unknown }) => void;
  onerror?: (event: { error: string }) => void;
  start(): void { /* nothing to start in a fake */ }
  stop(): void { this.stopped = true; }
}

function buildResultList(results: { transcript: string; isFinal: boolean }[]): unknown {
  const list: Record<number, unknown> & { length: number } = { length: results.length };
  results.forEach((result, index) => {
    list[index] = { 0: { transcript: result.transcript }, isFinal: result.isFinal, length: 1 };
  });
  return list;
}
