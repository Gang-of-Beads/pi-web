import {
  EXTENSION_DIALOG_INPUT_MAX_LENGTH,
  EXTENSION_DIALOG_SCREEN_MAX_LINES,
  EXTENSION_DIALOG_SCREEN_MAX_SPANS,
  type ScreenLine,
  type ScreenSpan,
} from "../../../shared/apiTypes";
import { isRecord } from "../../../shared/unknownValues";

/**
 * A drawn screen's styled lines and cursor, read leniently. The styling only dresses the plain
 * lines the dialog carries anyway, so a set this build cannot read is left out and the card draws
 * the plain lines; a strict read would drop the whole dialog, and with it the extension's question.
 */
export function parseScreenLines(value: unknown): ScreenLine[] | undefined {
  if (!Array.isArray(value) || value.length > EXTENSION_DIALOG_SCREEN_MAX_LINES) return undefined;
  const lines = value.map(screenLineOf);
  return lines.every((line): line is ScreenLine => line !== undefined) ? lines : undefined;
}

/** The cursor's line, when it is a line number at all. */
export function parseSelectedLine(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

const ROLE_MAX_LENGTH = 64;

function screenLineOf(value: unknown): ScreenLine | undefined {
  if (!isRecord(value)) return undefined;
  const spans = value["spans"];
  if (!Array.isArray(spans) || spans.length > EXTENSION_DIALOG_SCREEN_MAX_SPANS) return undefined;
  const read = spans.map(screenSpanOf);
  if (!read.every((span): span is ScreenSpan => span !== undefined)) return undefined;
  return { spans: read, ...(value["frame"] === true ? { frame: true as const } : {}) };
}

function roleOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" && value.length <= ROLE_MAX_LENGTH ? value : undefined;
}

function screenSpanOf(value: unknown): ScreenSpan | undefined {
  if (!isRecord(value)) return undefined;
  const text = value["text"];
  if (typeof text !== "string") return undefined;
  const fg = roleOf(value["fg"]);
  const bg = roleOf(value["bg"]);
  return {
    text: text.slice(0, EXTENSION_DIALOG_INPUT_MAX_LENGTH),
    ...(fg === undefined ? {} : { fg }),
    ...(bg === undefined ? {} : { bg }),
    ...(value["bold"] === true ? { bold: true as const } : {}),
    ...(value["dim"] === true ? { dim: true as const } : {}),
    ...(value["italic"] === true ? { italic: true as const } : {}),
    ...(value["underline"] === true ? { underline: true as const } : {}),
    ...(value["inverse"] === true ? { inverse: true as const } : {}),
    ...(value["strike"] === true ? { strike: true as const } : {}),
  };
}
