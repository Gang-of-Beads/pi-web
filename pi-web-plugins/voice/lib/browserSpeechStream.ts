import type { SpeechStreamEvent } from "./speechStreamProtocols.js";

/**
 * Live transcription using the browser's own recogniser.
 *
 * This is the one streaming path that needs nothing configured, so it is what
 * an install can try before choosing a service. The trade is that Chrome sends
 * the audio to its vendor, and not every browser offers it at all - which is
 * why it is one option among several rather than the only one.
 *
 * The API reports a growing list of results where settled entries stay put and
 * the last one keeps changing. That is neither socket protocol's shape, so it
 * is translated here into the same delta/final events the rest of the code
 * already understands.
 */
export interface BrowserSpeechWindow {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
}

export interface BrowserSpeechStreamOptions {
  window: BrowserSpeechWindow;
  onEvent: (event: SpeechStreamEvent) => void;
  onError: (message: string) => void;
  language?: string;
}

export interface BrowserSpeechStreamHandle {
  stop: () => void;
}

export function isBrowserSpeechAvailable(candidate: BrowserSpeechWindow): boolean {
  return recogniserConstructor(candidate) !== undefined;
}

export function startBrowserSpeechStream(options: BrowserSpeechStreamOptions): BrowserSpeechStreamHandle {
  const Recogniser = recogniserConstructor(options.window);
  if (Recogniser === undefined) {
    options.onError("This browser has no speech recogniser.");
    return { stop: () => undefined };
  }

  const recogniser = Recogniser();
  // Without interim results nothing arrives until the speaker stops, which is
  // the batch behaviour this exists to replace.
  recogniser["interimResults"] = true;
  recogniser["continuous"] = true;
  if (options.language !== undefined) recogniser["lang"] = options.language;

  recogniser["onresult"] = (event: unknown): void => {
    for (const result of readResults(event)) {
      options.onEvent(result.isFinal
        ? { kind: "final", text: result.transcript }
        : { kind: "delta", text: result.transcript });
    }
  };
  recogniser["onerror"] = (event: unknown): void => {
    options.onError(`Speech recognition failed: ${readErrorName(event)}`);
  };

  callMethod(recogniser, "start");
  return { stop: () => { callMethod(recogniser, "stop"); } };
}

type RecogniserFactory = () => Record<string, unknown>;

/**
 * The recogniser lives under two names: the standard one, and the prefixed one
 * Safari and older Chrome still ship. Constructing it behind a factory keeps
 * the rest of this file free of the `new` on an untyped global.
 */
function recogniserConstructor(candidate: BrowserSpeechWindow): RecogniserFactory | undefined {
  const found = [candidate.SpeechRecognition, candidate.webkitSpeechRecognition]
    .find((value) => typeof value === "function");
  if (typeof found !== "function") return undefined;
  return () => {
    const instance: unknown = Reflect.construct(found, []);
    return isRecord(instance) ? instance : {};
  };
}

function readResults(event: unknown): { transcript: string; isFinal: boolean }[] {
  if (!isRecord(event)) return [];
  const results = event["results"];
  if (!isRecord(results)) return [];
  const length = typeof results["length"] === "number" ? results["length"] : 0;
  const out: { transcript: string; isFinal: boolean }[] = [];
  for (let index = 0; index < length; index += 1) {
    const result = results[index];
    if (!isRecord(result)) continue;
    const alternative = result[0];
    const transcript = isRecord(alternative) && typeof alternative["transcript"] === "string"
      ? alternative["transcript"]
      : undefined;
    if (transcript === undefined || transcript === "") continue;
    out.push({ transcript, isFinal: result["isFinal"] === true });
  }
  return out;
}

function readErrorName(event: unknown): string {
  if (!isRecord(event)) return "unknown";
  return typeof event["error"] === "string" ? event["error"] : "unknown";
}

function callMethod(target: Record<string, unknown>, name: string): void {
  const method = target[name];
  if (typeof method === "function") Reflect.apply(method, target, []);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
