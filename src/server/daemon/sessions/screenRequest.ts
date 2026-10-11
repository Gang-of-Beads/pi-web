import { EXTENSION_DIALOG_INPUT_MAX_LENGTH, EXTENSION_DIALOG_KEY_MAX_LENGTH } from "../../../shared/apiTypes.js";

/**
 * What a browser asks of an open drawn screen on `POST /sessions/:id/dialog/key`: one key by name, a
 * tapped line by its number and text (walked to on the redraws), or the columns its card measured.
 * A body is exactly one of them: a body naming two would silently lose one (review 37163dda).
 */
export type ScreenRequest =
  | { kind: "key"; key: string }
  | { kind: "line"; line: number; text: string }
  | { kind: "width"; width: number };

const REQUEST_FIELDS = ["key", "line", "width"] as const;

/** One executor for each kind of request: a kind without one is a type error. */
export type ScreenRequestExecutors<T> = { [K in ScreenRequest["kind"]]: (request: Extract<ScreenRequest, { kind: K }>) => T };

export function performScreenRequest<T>(executors: ScreenRequestExecutors<T>, request: ScreenRequest): T {
  switch (request.kind) {
    case "key":
      return executors.key(request);
    case "line":
      return executors.line(request);
    case "width":
      return executors.width(request);
  }
}

export function screenRequest(body: { key?: unknown; line?: unknown; text?: unknown; width?: unknown }): ScreenRequest {
  const named = REQUEST_FIELDS.filter((field) => body[field] !== undefined);
  if (named.length !== 1) throw new Error("send exactly one of key, line or width");
  if (body.line !== undefined) return { kind: "line", line: nonNegativeInteger(body.line, "line"), text: boundedText(body.text, "text", EXTENSION_DIALOG_INPUT_MAX_LENGTH) };
  if (body.width !== undefined) return { kind: "width", width: nonNegativeInteger(body.width, "width") };
  return { kind: "key", key: boundedText(body.key, "key", EXTENSION_DIALOG_KEY_MAX_LENGTH) };
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} field must be a non-negative safe integer`);
  return value;
}

function boundedText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${field} field must be a string`);
  if (value === "") throw new Error(`${field} field must not be empty`);
  if (value.length > maxLength) throw new Error(`${field} field is too long`);
  return value;
}
