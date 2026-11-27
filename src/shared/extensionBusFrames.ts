/**
 * What the extension bus carries between a session's daemon and the page
 * (docs/design/extension-bus.md, "The page side").
 *
 * A frame travels inside a `pi.event` session frame, as its `bus` member: a page older than the bus
 * reads `pi.event` and ignores it, where a frame type it does not know would be dropped and counted
 * as a gap in the stream.
 */

import type { BusFrameAddress, ExtensionBusFrame } from "./apiTypes.js";
import { isRecord } from "./unknownValues.js";

/** The `eventType` of the `pi.event` that carries a bus frame. */
export const BUS_FRAME_EVENT_TYPE = "piweb:bus";

export type { BusEventFrame, BusStateFrame, ExtensionBusFrame } from "./apiTypes.js";

export interface BusStateEntry extends BusFrameAddress { readonly value: unknown }

/** Every retained state of a session's bus, with the revision it is current through. */
export interface ExtensionBusSnapshot {
  readonly epoch: string;
  readonly revision: number;
  readonly states: readonly BusStateEntry[];
}

export type BusRequestErrorCode = "not-declared" | "not-allowed" | "no-runtime" | "too-large" | "not-json" | "timeout" | "extension-error";
export interface BusRequestError { readonly code: BusRequestErrorCode; readonly message: string }
export type BusRequestAnswer = { readonly result: unknown } | { readonly error: BusRequestError };

const ERROR_CODES: Readonly<Record<BusRequestErrorCode, true>> = { "not-declared": true, "not-allowed": true, "no-runtime": true, "too-large": true, "not-json": true, timeout: true, "extension-error": true };

function isErrorCode(value: unknown): value is BusRequestErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_CODES, value);
}

function pluginsOf(value: unknown): { plugins?: readonly string[] } | undefined {
  if (value === undefined) return {};
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? { plugins: value } : undefined;
}

/** A frame as the page reads it, or undefined for anything else: a frame this page cannot read is not carried on. */
export function parseBusFrame(value: unknown): ExtensionBusFrame | undefined {
  if (!isRecord(value) || typeof value["channel"] !== "string") return undefined;
  const plugins = pluginsOf(value["plugins"]);
  if (plugins === undefined) return undefined;
  const address = { channel: value["channel"], ...plugins };
  if (value["kind"] === "event") {
    const dropped = value["dropped"];
    return { kind: "event", ...address, value: value["value"], ...(typeof dropped === "number" ? { dropped } : {}) };
  }
  if (value["kind"] !== "state" || typeof value["epoch"] !== "string" || typeof value["revision"] !== "number") return undefined;
  return { kind: "state", ...address, epoch: value["epoch"], revision: value["revision"], ...("value" in value ? { value: value["value"] } : {}) };
}

export function parseBusSnapshot(value: unknown): ExtensionBusSnapshot {
  if (!isRecord(value) || typeof value["epoch"] !== "string" || typeof value["revision"] !== "number" || !Array.isArray(value["states"])) throw new Error("Invalid extension bus snapshot");
  const states = value["states"].flatMap((entry: unknown): BusStateEntry[] => {
    const plugins = isRecord(entry) ? pluginsOf(entry["plugins"]) : undefined;
    return isRecord(entry) && typeof entry["channel"] === "string" && plugins !== undefined ? [{ channel: entry["channel"], value: entry["value"], ...plugins }] : [];
  });
  return { epoch: value["epoch"], revision: value["revision"], states };
}

export function parseBusRequestAnswer(value: unknown): BusRequestAnswer {
  if (!isRecord(value)) throw new Error("Invalid extension bus answer");
  const error = value["error"];
  if (error === undefined) return { result: value["result"] };
  const code = isRecord(error) ? error["code"] : undefined;
  const message = isRecord(error) ? error["message"] : undefined;
  if (!isErrorCode(code) || typeof message !== "string") throw new Error("Invalid extension bus answer");
  return { error: { code, message } };
}

/** Whether a plugin may read or ask a channel addressed this way. */
export function busReadableBy(address: { readonly plugins?: readonly string[] | undefined }, pluginId: string): boolean {
  return address.plugins === undefined || address.plugins.includes(pluginId);
}
