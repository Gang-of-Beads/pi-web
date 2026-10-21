import { isRecord } from "../../shared/unknownValues.js";

export const TERMINAL_CREATE_BODY_ERROR = "A terminal create body must be a JSON object";

/**
 * A terminal create's fields, or undefined for a body that is present but not a JSON object. The
 * web process parses other content types to a Buffer, whose spread kept none of the fields: a
 * start command sent that way was lost while the shell was made (review d3c7f62a, safety P2), so
 * such a body is refused instead. No body at all is a plain shell, as before.
 */
export function terminalCreateFields(body: unknown): Record<string, unknown> | undefined {
  if (body === undefined) return {};
  return isRecord(body) && !Buffer.isBuffer(body) ? body : undefined;
}
