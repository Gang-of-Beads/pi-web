import { thumbHashToRgba } from "../../../shared/thumbhash";
import type { StagedFile, StagedFileInfo, StagedFileRequest, StagedFileStage, StagedFileStageKind, StagedFileState } from "../../../shared/pluginApiTypes";
import { isRecord } from "../../../shared/unknownValues";
import { QUIET_WINDOW_MS, retryDelayMs } from "../sync/readPhase";
import { loadsUnasked } from "./loadingPolicy";
import type { NetworkEstimate } from "./networkEstimate";

/**
 * One file's preview stages for a plugin to draw, loaded in the order the plugin declared them while
 * the element showing them is on screen. The host's loading rule decides which stage loads without
 * the reader asking; the plugin asks for the rest with `advance()` and only draws the state. A stage
 * the machine cannot make or show is reported with its reason and skipped, never shown as loading,
 * so a thumbnail that cannot be made never keeps the file itself from loading. An answer that does
 * not come is asked for again by itself, on the shared backoff, keeping what is shown: a preview is
 * never left failed (B48). Leaving the screen stops what is in flight until the element returns,
 * and `cancel()` stops for good. The
 * stages are fetched directly with their own cancellation, as an image element would load them,
 * outside the app's request transport.
 */

export interface StagedFileSource {
  /** Browser-ready URL of one stage of the requested version of the file. */
  stageUrl(stage: string): string;
  /** Browser-ready URL of the file itself. */
  readonly originalUrl: string;
  readonly network: NetworkEstimate;
}

type StageOutcome =
  | { readonly kind: "facts"; readonly info: StagedFileInfo; readonly thumbhash: string | undefined }
  | { readonly kind: "drawn"; readonly url: string }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "unanswered"; readonly reason: string }
  | { readonly kind: "stopped" };

/** What an answer other than the stage says: skip the stage, or ask for it again. */
type Refusal = "cannot-make" | "older-machine" | "changed" | "no-answer";

const OLDER_MACHINE_REASON = "this machine runs an older PI WEB; update it to see previews";

const REFUSAL_OUTCOMES: Record<Refusal, (reason: string) => StageOutcome> = {
  "cannot-make": (reason) => ({ kind: "unavailable", reason }),
  "older-machine": () => ({ kind: "unavailable", reason: OLDER_MACHINE_REASON }),
  changed: () => ({ kind: "unavailable", reason: "the file changed since it was listed" }),
  "no-answer": (reason) => ({ kind: "unanswered", reason }),
};

/** Kinds that load the file itself rather than a stage of it. */
const ORIGINAL_KINDS: ReadonlySet<StagedFileStageKind> = new Set(["original-image", "original-stream"]);
const PROGRESS_EVERY_MS = 500;
/** How much of a transfer must have arrived, over how long, before its own rate says how long the rest takes. */
const OWN_RATE_MIN_BYTES = 32 * 1024;
const OWN_RATE_MIN_MS = 1_000;

export function createStagedFile(source: StagedFileSource, request: StagedFileRequest): StagedFile {
  const listeners = new Set<(state: StagedFileState) => void>();
  const objectUrls: string[] = [];
  let state: StagedFileState = { status: "idle" };
  let status: StagedFileState["status"] = "idle";
  let shown: StagedFileState["shown"];
  let info: StagedFileInfo | undefined;
  let placeholder: string | undefined;
  let next: StagedFileState["next"];
  let unavailableReason: string | undefined;
  let noAnswer: string | undefined;
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let index = 0;
  let asked = false;
  let onScreen = false;
  let closed = false;
  let running = false;
  let inFlight: AbortController | undefined;
  let observer: IntersectionObserver | undefined;

  /** Read through calls: `cancel()` and the observer change these while a stage loads. */
  const isClosed = (): boolean => closed;
  const isLive = (): boolean => !closed && onScreen;
  const publish = (): void => {
    const reason = noAnswer ?? unavailableReason;
    state = {
      status,
      ...(shown === undefined ? {} : { shown }),
      ...(info === undefined ? {} : { info }),
      ...(placeholder === undefined ? {} : { placeholder }),
      ...(next === undefined ? {} : { next }),
      ...(reason === undefined ? {} : { reason }),
    };
    for (const listener of listeners) listener(state);
  };
  const nothingShown = (): boolean => shown?.url === undefined && info === undefined;
  const restingStatus = (): StagedFileState["status"] => (nothingShown() && unavailableReason !== undefined ? "unavailable" : "shown");

  const describe = (stage: StagedFileStage): NonNullable<StagedFileState["next"]> => {
    if (!ORIGINAL_KINDS.has(stage.kind)) return { name: stage.name, kind: stage.kind };
    const estimateMs = source.network.estimateMs(request.version.size);
    return { name: stage.name, kind: stage.kind, bytes: request.version.size, ...(estimateMs === undefined ? {} : { estimateMs }) };
  };

  /** Records what a stage came to; whether the next stage may follow. */
  const applyOutcome = (outcome: StageOutcome, stage: StagedFileStage): boolean => {
    switch (outcome.kind) {
      case "facts":
        shown = { name: stage.name };
        info = outcome.info;
        placeholder = outcome.thumbhash === undefined ? undefined : placeholderUrl(outcome.thumbhash);
        attempts = 0;
        return true;
      case "drawn":
        shown = { name: stage.name, url: outcome.url };
        attempts = 0;
        return true;
      case "unavailable":
        unavailableReason ??= outcome.reason;
        attempts = 0;
        return true;
      case "unanswered":
        status = "retrying";
        noAnswer = outcome.reason;
        retry = setTimeout(() => { void run(); }, retryDelayMs(attempts, QUIET_WINDOW_MS));
        attempts += 1;
        return false;
      case "stopped":
        status = nothingShown() ? "idle" : "shown";
        return false;
    }
  };

  const load = async (stage: StagedFileStage): Promise<StageOutcome> => {
    if (stage.kind === "original-stream") return { kind: "drawn", url: source.originalUrl };
    const controller = new AbortController();
    inFlight = controller;
    try {
      const original = stage.kind === "original-image";
      const url = original ? source.originalUrl : source.stageUrl(stage.name);
      const started = performance.now();
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return await refusedStage(response, original);
      if (stage.kind === "info") return { kind: "facts", ...parseFacts(await response.json().catch(() => undefined)) };
      const blob = await readWithProgress(response, (loaded, elapsedMs) => { reportProgress(stage, loaded, elapsedMs); });
      const transfer = bodyTransfer(url, blob.size, performance.now() - started);
      source.network.record(transfer.bytes, transfer.ms);
      const objectUrl = URL.createObjectURL(blob);
      if (isClosed()) {
        URL.revokeObjectURL(objectUrl);
        return { kind: "stopped" };
      }
      objectUrls.push(objectUrl);
      return { kind: "drawn", url: objectUrl };
    } catch (error) {
      if (controller.signal.aborted) return { kind: "stopped" };
      return { kind: "unanswered", reason: error instanceof Error ? error.message : String(error) };
    } finally {
      if (inFlight === controller) inFlight = undefined;
    }
  };

  /** How much of the loading stage has arrived and how long the rest would take, about twice a second. */
  const reportProgress = (stage: StagedFileStage, loaded: number, elapsedMs: number): void => {
    const described = describe(stage);
    const remaining = described.bytes === undefined ? undefined : Math.max(0, described.bytes - loaded);
    const ownRate = loaded >= OWN_RATE_MIN_BYTES && elapsedMs >= OWN_RATE_MIN_MS ? loaded / elapsedMs : undefined;
    const estimateMs = remaining === undefined ? undefined : ownRate === undefined ? source.network.estimateMs(remaining) : Math.round(remaining / ownRate);
    next = {
      name: described.name,
      kind: described.kind,
      ...(described.bytes === undefined ? {} : { bytes: described.bytes }),
      loaded,
      ...(estimateMs === undefined ? {} : { estimateMs }),
    };
    publish();
  };

  const run = async (): Promise<void> => {
    clearTimeout(retry);
    retry = undefined;
    if (running || !isLive()) return;
    running = true;
    try {
      for (let stage = request.stages[index]; stage !== undefined && isLive(); stage = request.stages[index]) {
        const waits = !loadsUnasked(stage.kind);
        next = describe(stage);
        if (waits && !asked) {
          status = restingStatus();
          publish();
          return;
        }
        status = "loading";
        noAnswer = undefined;
        publish();
        const outcome = await load(stage);
        if (isClosed()) return;
        const goesOn = applyOutcome(outcome, stage);
        if (goesOn) {
          if (waits) asked = false;
          index += 1;
        }
        publish();
        if (!goesOn) return;
      }
      if (!isClosed() && index >= request.stages.length) {
        next = undefined;
        status = restingStatus();
        publish();
      }
    } finally {
      running = false;
    }
  };

  return {
    get state() { return state; },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    observe(element) {
      if (closed) return;
      observer?.disconnect();
      if (typeof Reflect.get(globalThis, "IntersectionObserver") !== "function") {
        onScreen = true;
        void run();
        return;
      }
      observer = new IntersectionObserver((entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible === onScreen) return;
        onScreen = visible;
        if (visible) void run();
        else inFlight?.abort();
      });
      observer.observe(element);
    },
    advance() {
      if (closed) return;
      asked = true;
      void run();
    },
    cancel() {
      closed = true;
      clearTimeout(retry);
      inFlight?.abort();
      observer?.disconnect();
      for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);
      listeners.clear();
    },
  };
}

/** The body as a blob, reporting how much has arrived about twice a second. */
async function readWithProgress(response: Response, onProgress: (loaded: number, elapsedMs: number) => void): Promise<Blob> {
  const reader = response.body?.getReader();
  if (reader === undefined) return response.blob();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const started = performance.now();
  let loaded = 0;
  let reportedAt = started;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    chunks.push(read.value);
    loaded += read.value.byteLength;
    const now = performance.now();
    if (now - reportedAt < PROGRESS_EVERY_MS) continue;
    reportedAt = now;
    onProgress(loaded, now - started);
  }
  return new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
}

/**
 * How long a stage's bytes took to arrive, from the browser's resource timing when it has the entry:
 * from the first byte to the last, so a small stage on a slow-to-answer link is not taken for a slow
 * link (an 11 KB thumbnail behind 300 ms of latency once read as 2 KB/s and promised a 3.6 MB photo
 * in 33 minutes instead of 6). Otherwise, as for another origin that does not share its timing (its
 * `responseStart` reads 0), the whole fetch is timed.
 */
function bodyTransfer(url: string, bytes: number, elapsedMs: number): { bytes: number; ms: number } {
  const timing = performance.getEntriesByName(url, "resource").at(-1);
  if (!(timing instanceof PerformanceResourceTiming) || timing.responseStart <= 0 || timing.responseEnd <= timing.responseStart) return { bytes, ms: elapsedMs };
  return { bytes: timing.encodedBodySize > 0 ? timing.encodedBodySize : bytes, ms: timing.responseEnd - timing.responseStart };
}

async function refusedStage(response: Response, original: boolean): Promise<StageOutcome> {
  const body: unknown = await response.json().catch(() => undefined);
  const said = isRecord(body) ? body["reason"] ?? body["error"] : undefined;
  const saysWhy = typeof said === "string" && said !== "" && said !== "Not Found";
  const reason = saysWhy ? said : `the machine answered ${String(response.status)}`;
  return REFUSAL_OUTCOMES[refusalOf(response.status, original, saysWhy)](reason);
}

/**
 * What a machine's answer other than success means. 408, 429 and 502-504 are no answer from the
 * machine, and neither is a 500 for the file itself, so the same stage is asked for again. For a
 * stage, 409 says the file changed since it was listed, a bare 404 that the machine's PI WEB makes
 * no stages yet (an older remote machine), and any other refusal or a 500 that it cannot make this
 * one; the stage is skipped and the file itself still loads. The file itself refused is a file this
 * page cannot show, such as one deleted since it was listed.
 */
function refusalOf(status: number, original: boolean, saysWhy: boolean): Refusal {
  if (status === 408 || status === 429 || status >= 502) return "no-answer";
  if (original) return status >= 500 ? "no-answer" : "cannot-make";
  if (status === 409) return "changed";
  return status === 404 && !saysWhy ? "older-machine" : "cannot-make";
}

function parseFacts(value: unknown): { info: StagedFileInfo; thumbhash: string | undefined } {
  const fields = isRecord(value) ? value : {};
  const number = (key: string): number | undefined => {
    const field = fields[key];
    return typeof field === "number" && Number.isFinite(field) && field > 0 ? field : undefined;
  };
  const width = number("width");
  const height = number("height");
  const durationS = number("durationS");
  const thumbhash = fields["thumbhash"];
  return {
    info: {
      ...(width === undefined || height === undefined ? {} : { width, height }),
      ...(durationS === undefined ? {} : { durationS }),
    },
    thumbhash: typeof thumbhash === "string" && thumbhash !== "" ? thumbhash : undefined,
  };
}

/** The ThumbHash drawn as a small PNG, or `undefined` where the browser cannot draw one. */
function placeholderUrl(thumbhash: string): string | undefined {
  try {
    const image = thumbHashToRgba(Uint8Array.from(atob(thumbhash), (character) => character.charCodeAt(0)));
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) return undefined;
    context.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  }
}
