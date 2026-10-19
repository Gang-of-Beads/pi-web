import type { DeviceOperation, OperationBatch, OperationResult, PromptAttachment } from "../../../shared/apiTypes.js";
import { isWellFormedOperationId } from "./operationDecision.js";
import { isPiWebPluginId } from "../../../shared/pluginIds.js";
import { sessionErrorReply } from "./sessionErrors.js";

/**
 * A device's batch of operations on one session (docs/design/message-states.md, "The machine"):
 * parsed strictly at the boundary, applied in order, stopped at the first operation that is not
 * applied. Pure: the session service applies each operation; this module reads the request and
 * names what each failure means for the device.
 */

const DEVICE_ID = /^[A-Za-z0-9._:-]{8,128}$/u;
const MAX_OPERATIONS = 64;

/** The request is not a batch this machine can read; the route answers 400. */
export class OperationBatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationBatchError";
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new OperationBatchError(`Each operation needs a ${field} string.`);
  return value;
}

/** Shallow: the session service parses each attachment strictly when it accepts the message. */
function isAttachmentList(value: unknown): value is PromptAttachment[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "object" && item !== null);
}

function lane(value: unknown): "steer" | "followUp" | undefined {
  return value === "steer" || value === "followUp" ? value : undefined;
}

type Parser = (body: Record<string, unknown>, head: { seq: number; clientMessageId: string }) => DeviceOperation;

const PARSERS: Readonly<Record<DeviceOperation["kind"], Parser>> = {
  message: (body, head) => {
    const behavior = lane(body["streamingBehavior"]);
    const attachments = body["attachments"];
    const sentAt = body["sentAt"];
    const via = body["via"];
    if (via !== undefined && (typeof via !== "string" || !isPiWebPluginId(via))) throw new OperationBatchError("A message's via names the plugin that sent it, by its id.");
    return {
      kind: "message",
      ...head,
      text: text(body["text"], "text"),
      ...(behavior === undefined ? {} : { streamingBehavior: behavior }),
      ...(isAttachmentList(attachments) ? { attachments } : {}),
      ...(typeof sentAt === "string" ? { sentAt } : {}),
      ...(via === undefined ? {} : { via }),
    };
  },
  takeBack: (body, head) => {
    const kind = lane(body["lane"]);
    const words = body["text"];
    return { kind: "takeBack", ...head, target: text(body["target"], "target"), text: typeof words === "string" ? words : "", ...(kind === undefined ? {} : { lane: kind }) };
  },
  command: (body, head) => ({ kind: "command", ...head, text: text(body["text"], "text") }),
  shell: (body, head) => ({ kind: "shell", ...head, text: text(body["text"], "text") }),
};

function isKind(value: unknown): value is DeviceOperation["kind"] {
  return typeof value === "string" && Object.hasOwn(PARSERS, value);
}

function parseOperation(value: unknown): DeviceOperation {
  const body = record(value);
  if (body === undefined) throw new OperationBatchError("Each operation must be an object.");
  const seq = body["seq"];
  const clientMessageId = body["clientMessageId"];
  const kind = body["kind"];
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) throw new OperationBatchError("Each operation needs a positive whole seq.");
  if (typeof clientMessageId !== "string" || !isWellFormedOperationId(clientMessageId)) throw new OperationBatchError("Each operation needs a clientMessageId the ledger can hold: 8 to 128 letters, digits, dots, colons, dashes or underscores.");
  if (!isKind(kind)) throw new OperationBatchError("Each operation needs a kind: message, takeBack, command or shell.");
  return PARSERS[kind](body, { seq, clientMessageId });
}

export function parseOperationBatch(value: unknown): OperationBatch {
  const body = record(value);
  if (body === undefined) throw new OperationBatchError("Expected a batch of operations.");
  const deviceId = body["deviceId"];
  const ackedThrough = body["ackedThrough"];
  const operations = body["operations"];
  if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) throw new OperationBatchError("A batch needs its deviceId.");
  if (typeof ackedThrough !== "number" || !Number.isSafeInteger(ackedThrough) || ackedThrough < 0) throw new OperationBatchError("A batch needs ackedThrough.");
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > MAX_OPERATIONS) throw new OperationBatchError(`A batch carries 1 to ${String(MAX_OPERATIONS)} operations.`);
  return { deviceId, ackedThrough, operations: operations.map(parseOperation) };
}

/** The statuses that let the batch go on to its next operation. */
const GOES_ON: Readonly<Record<OperationResult["status"], boolean>> = { applied: true, stopped: false, refused: false, notAttempted: false };

export function batchGoesOn(result: OperationResult): boolean {
  return GOES_ON[result.status];
}

/**
 * What an error applying one operation means for the device: out of step (number it again), or
 * refused, as the single-operation routes answered any error they did not name (400).
 */
export function resultForError(operation: DeviceOperation, error: unknown): OperationResult {
  const head = { seq: operation.seq, clientMessageId: operation.clientMessageId };
  const reply = sessionErrorReply(error, 400);
  const code = reply.body.code;
  if ((code === "sequence-gap" || code === "sequence-stale") && reply.body.appliedThrough !== undefined) return { ...head, status: "stopped", code, appliedThrough: reply.body.appliedThrough };
  return { ...head, status: "refused", httpStatus: reply.status, error: reply.body.error, ...(code === undefined ? {} : { code }) };
}
