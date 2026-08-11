import { Buffer } from "node:buffer";

type TerminalSequenceState =
  | "control-string"
  | "control-string-escape"
  | "csi"
  | "escape"
  | "text";

const escapeCharacter = 0x1b;
const c1Csi = 0x9b;
const c1StringTerminator = 0x9c;
const c1ControlStringIntroducers = new Set([0x90, 0x98, 0x9d, 0x9e, 0x9f]);

/**
 * Removes terminal control sequences before diagnostic text reaches a log or
 * browser boundary. State is retained so an escape sequence split across
 * process chunks cannot be used to split a credential.
 */
class SafeTunnelTerminalTextSanitizer {
  private state: TerminalSequenceState = "text";

  write(chunk: string): string {
    let output = "";
    for (const character of chunk) {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) continue;

      switch (this.state) {
        case "text":
          if (codePoint === escapeCharacter) {
            this.state = "escape";
          } else if (codePoint === c1Csi) {
            this.state = "csi";
          } else if (c1ControlStringIntroducers.has(codePoint)) {
            this.state = "control-string";
          } else if (codePoint === 0x09 || codePoint === 0x0a) {
            output += character;
          } else if (isTerminalControl(codePoint)) {
            // Other C0/C1 controls (including carriage return and backspace)
            // are discarded so they cannot reconstruct hidden text later.
          } else {
            output += character;
          }
          break;
        case "escape":
          if (codePoint === 0x5b) {
            this.state = "csi";
          } else if (
            codePoint === 0x50
            || codePoint === 0x58
            || codePoint === 0x5d
            || codePoint === 0x5e
            || codePoint === 0x5f
          ) {
            this.state = "control-string";
          } else if (codePoint === escapeCharacter) {
            this.state = "escape";
          } else if (codePoint >= 0x30 && codePoint <= 0x7e) {
            this.state = "text";
          }
          break;
        case "csi":
          if (codePoint === escapeCharacter) {
            this.state = "escape";
          } else if (codePoint >= 0x40 && codePoint <= 0x7e) {
            this.state = "text";
          }
          break;
        case "control-string":
          if (codePoint === escapeCharacter) {
            this.state = "control-string-escape";
          } else if (codePoint === 0x07 || codePoint === c1StringTerminator) {
            this.state = "text";
          }
          break;
        case "control-string-escape":
          if (codePoint === 0x5c || codePoint === c1StringTerminator) {
            this.state = "text";
          } else if (codePoint === escapeCharacter) {
            this.state = "control-string-escape";
          } else {
            this.state = "control-string";
          }
          break;
      }
    }
    return output;
  }

  flush(): string {
    // An unterminated control sequence is diagnostic formatting, not text.
    this.state = "text";
    return "";
  }
}

/** Detects direct or one-layer serialized credential aliases after terminal sanitization. */
export function containsSafeTunnelSensitiveRepresentation(
  value: string,
  sensitiveValues: readonly string[],
): boolean {
  const sanitizer = new SafeTunnelTerminalTextSanitizer();
  const sanitized = `${sanitizer.write(value)}${sanitizer.flush()}`;
  return new SafeTunnelSensitiveRepresentationMatcher(sensitiveValues)
    .contains(sanitized);
}

/** Redacts known credentials from one complete diagnostic value. */
export function redactSafeTunnelDiagnostic(
  value: string,
  sensitiveValues: readonly string[],
): string {
  const sanitizer = new SafeTunnelTerminalTextSanitizer();
  const sanitized = `${sanitizer.write(value)}${sanitizer.flush()}`;
  const matcher = new SafeTunnelSensitiveRepresentationMatcher(sensitiveValues);
  return matcher.redact(sanitized, redactionMarker(matcher.values));
}

/**
 * Streaming counterpart used for child stdout/stderr. One chronological carry
 * is shared across both streams so chunk, stream, percent-escape, or JSON-escape
 * boundaries cannot split a credential before it is persisted. Carry is
 * bounded by the longest supported one-layer representation, not log volume.
 */
export class SafeTunnelStreamingDiagnosticRedactor {
  private carry = "";
  private readonly marker: string;
  private readonly matcher: SafeTunnelSensitiveRepresentationMatcher;
  private readonly sanitizer = new SafeTunnelTerminalTextSanitizer();

  constructor(sensitiveValues: readonly string[]) {
    this.matcher = new SafeTunnelSensitiveRepresentationMatcher(sensitiveValues);
    this.marker = redactionMarker(this.matcher.values);
  }

  write(chunk: string): string {
    this.carry += this.sanitizer.write(chunk);
    if (this.matcher.values.length === 0) {
      const output = this.carry;
      this.carry = "";
      return output;
    }

    const retainedCharacters = this.matcher.maximumRepresentationCharacters - 1;
    const nominalBoundary = Math.max(0, this.carry.length - retainedCharacters);
    let boundary = nominalBoundary;
    for (const match of this.matcher.matches(this.carry)) {
      if (match.start < nominalBoundary && match.end > nominalBoundary) {
        boundary = Math.min(boundary, match.start);
      }
    }

    const stable = this.carry.slice(0, boundary);
    this.carry = this.carry.slice(boundary);
    return this.matcher.redact(stable, this.marker);
  }

  flush(): string {
    this.carry += this.sanitizer.flush();
    const output = this.matcher.redact(this.carry, this.marker);
    this.carry = "";
    return output;
  }
}

interface SensitiveValue {
  readonly text: string;
  readonly utf8: Buffer;
}

interface TextRange {
  readonly end: number;
  readonly start: number;
}

interface DecodedBytes {
  readonly bytes: Buffer;
  readonly ends: readonly number[];
  readonly starts: readonly number[];
}

interface DecodedText {
  readonly ends: readonly number[];
  readonly starts: readonly number[];
  readonly text: string;
}

/**
 * Finds aliases by decoding the input once rather than enumerating every mixed
 * escaped spelling. That keeps setup and streaming carry linear in the bounded
 * secret size while covering arbitrary per-byte percent escapes and arbitrary
 * per-character JSON escapes.
 */
class SafeTunnelSensitiveRepresentationMatcher {
  readonly maximumRepresentationCharacters: number;
  readonly values: readonly string[];
  private readonly sensitiveValues: readonly SensitiveValue[];

  constructor(values: readonly string[]) {
    this.values = normalizeSensitiveValues(values);
    this.sensitiveValues = this.values.map((text) => ({
      text,
      utf8: Buffer.from(text, "utf8"),
    }));
    this.maximumRepresentationCharacters = this.sensitiveValues.reduce(
      (maximum, value) => Math.max(
        maximum,
        value.text.length,
        value.text.length * 6,
        value.utf8.length * 3,
      ),
      0,
    );
  }

  contains(value: string): boolean {
    return this.matches(value).length > 0;
  }

  matches(value: string): readonly TextRange[] {
    if (value === "" || this.sensitiveValues.length === 0) return [];

    const matches: TextRange[] = [];
    for (const sensitiveValue of this.sensitiveValues) {
      addDirectMatches(value, sensitiveValue.text, matches);
    }

    const uriDecoded = decodePercentEncodedBytes(value, false);
    addDecodedByteMatches(uriDecoded, this.sensitiveValues, matches);
    if (this.sensitiveValues.some(({ text }) => text.includes(" "))) {
      addDecodedByteMatches(
        decodePercentEncodedBytes(value, true),
        this.sensitiveValues,
        matches,
      );
    }

    const jsonDecoded = decodeJsonStringContents(value);
    for (const sensitiveValue of this.sensitiveValues) {
      addDecodedTextMatches(jsonDecoded, sensitiveValue.text, matches);
    }
    return mergeRanges(matches);
  }

  redact(value: string, marker: string): string {
    if (marker === "" && this.sensitiveValues.length > 0) return "";
    const matches = this.matches(value);
    if (matches.length === 0) return value;

    let cursor = 0;
    let redacted = "";
    for (const match of matches) {
      redacted += `${value.slice(cursor, match.start)}${marker}`;
      cursor = match.end;
    }
    return `${redacted}${value.slice(cursor)}`;
  }
}

function normalizeSensitiveValues(values: readonly string[]): readonly string[] {
  const normalized = new Set<string>();
  for (const value of values) {
    if (value === "") continue;
    const sanitizer = new SafeTunnelTerminalTextSanitizer();
    const sanitized = `${sanitizer.write(value)}${sanitizer.flush()}`;
    if (sanitized !== "") normalized.add(sanitized);
  }
  return [...normalized].sort((left, right) => right.length - left.length);
}

function addDirectMatches(
  value: string,
  sensitiveValue: string,
  matches: TextRange[],
): void {
  let offset = 0;
  while (offset <= value.length - sensitiveValue.length) {
    const start = value.indexOf(sensitiveValue, offset);
    if (start < 0) return;
    matches.push({ start, end: start + sensitiveValue.length });
    offset = start + 1;
  }
}

function decodePercentEncodedBytes(value: string, formEncoded: boolean): DecodedBytes {
  const bytes: number[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const append = (encoded: Uint8Array, start: number, end: number): void => {
    for (const byte of encoded) {
      bytes.push(byte);
      starts.push(start);
      ends.push(end);
    }
  };

  for (let index = 0; index < value.length;) {
    if (value[index] === "%" && index + 2 < value.length) {
      const high = hexValue(value.charCodeAt(index + 1));
      const low = hexValue(value.charCodeAt(index + 2));
      if (high >= 0 && low >= 0) {
        append(Uint8Array.of((high * 16) + low), index, index + 3);
        index += 3;
        continue;
      }
    }
    if (formEncoded && value[index] === "+") {
      append(Uint8Array.of(0x20), index, index + 1);
      index += 1;
      continue;
    }

    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    append(Buffer.from(character, "utf8"), index, index + character.length);
    index += character.length;
  }
  return { bytes: Buffer.from(bytes), starts, ends };
}

function addDecodedByteMatches(
  decoded: DecodedBytes,
  sensitiveValues: readonly SensitiveValue[],
  matches: TextRange[],
): void {
  for (const sensitiveValue of sensitiveValues) {
    let offset = 0;
    while (offset <= decoded.bytes.length - sensitiveValue.utf8.length) {
      const index = decoded.bytes.indexOf(sensitiveValue.utf8, offset);
      if (index < 0) break;
      const lastIndex = index + sensitiveValue.utf8.length - 1;
      if (isDecodedByteBoundary(decoded, index, lastIndex)) {
        const start = decoded.starts[index];
        const end = decoded.ends[lastIndex];
        if (start !== undefined && end !== undefined) matches.push({ start, end });
      }
      offset = index + 1;
    }
  }
}

function isDecodedByteBoundary(
  decoded: DecodedBytes,
  firstIndex: number,
  lastIndex: number,
): boolean {
  const startsInsideRawCharacter = firstIndex > 0
    && decoded.starts[firstIndex - 1] === decoded.starts[firstIndex]
    && decoded.ends[firstIndex - 1] === decoded.ends[firstIndex];
  const endsInsideRawCharacter = lastIndex + 1 < decoded.bytes.length
    && decoded.starts[lastIndex + 1] === decoded.starts[lastIndex]
    && decoded.ends[lastIndex + 1] === decoded.ends[lastIndex];
  return !startsInsideRawCharacter && !endsInsideRawCharacter;
}

function decodeJsonStringContents(value: string): DecodedText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  const append = (decoded: string, start: number, end: number): void => {
    text += decoded;
    let remainingCodeUnits = decoded.length;
    while (remainingCodeUnits > 0) {
      starts.push(start);
      ends.push(end);
      remainingCodeUnits -= 1;
    }
  };

  for (let index = 0; index < value.length;) {
    if (value[index] === "\\" && index + 1 < value.length) {
      const escaped = value[index + 1];
      const simple = escaped === "\"" || escaped === "\\" || escaped === "/"
        ? escaped
        : escaped === "b"
          ? "\b"
          : escaped === "f"
            ? "\f"
            : escaped === "n"
              ? "\n"
              : escaped === "r"
                ? "\r"
                : escaped === "t"
                  ? "\t"
                  : undefined;
      if (simple !== undefined) {
        append(simple, index, index + 2);
        index += 2;
        continue;
      }
      if (escaped === "u" && index + 5 < value.length) {
        let codeUnit = 0;
        let valid = true;
        for (let digit = index + 2; digit <= index + 5; digit += 1) {
          const hex = hexValue(value.charCodeAt(digit));
          if (hex < 0) {
            valid = false;
            break;
          }
          codeUnit = (codeUnit * 16) + hex;
        }
        if (valid) {
          append(String.fromCharCode(codeUnit), index, index + 6);
          index += 6;
          continue;
        }
      }
    }

    append(value[index] ?? "", index, index + 1);
    index += 1;
  }
  return { text, starts, ends };
}

function addDecodedTextMatches(
  decoded: DecodedText,
  sensitiveValue: string,
  matches: TextRange[],
): void {
  let offset = 0;
  while (offset <= decoded.text.length - sensitiveValue.length) {
    const index = decoded.text.indexOf(sensitiveValue, offset);
    if (index < 0) return;
    const start = decoded.starts[index];
    const end = decoded.ends[index + sensitiveValue.length - 1];
    if (start !== undefined && end !== undefined) matches.push({ start, end });
    offset = index + 1;
  }
}

function mergeRanges(ranges: readonly TextRange[]): readonly TextRange[] {
  const sorted = [...ranges].sort((left, right) => (
    left.start - right.start || left.end - right.end
  ));
  const merged: TextRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || range.start > previous.end) {
      merged.push(range);
      continue;
    }
    if (range.end > previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: range.end };
    }
  }
  return merged;
}

function hexValue(codeUnit: number): number {
  if (codeUnit >= 0x30 && codeUnit <= 0x39) return codeUnit - 0x30;
  if (codeUnit >= 0x41 && codeUnit <= 0x46) return codeUnit - 0x41 + 10;
  if (codeUnit >= 0x61 && codeUnit <= 0x66) return codeUnit - 0x61 + 10;
  return -1;
}

function redactionMarker(secrets: readonly string[]): string {
  const usedCharacters = new Set<string>();
  for (const secret of secrets) {
    for (const character of secret) usedCharacters.add(character);
  }

  for (const candidate of ["█", "◆", "�"]) {
    if (!usedCharacters.has(candidate)) return candidate;
  }
  for (let codePoint = 0xe000; codePoint <= 0xf8ff; codePoint += 1) {
    const candidate = String.fromCodePoint(codePoint);
    if (!usedCharacters.has(candidate)) return candidate;
  }

  // Production credentials and paths are bounded far below the private-use
  // range. Withhold diagnostics rather than risk creating a credential if an
  // injected implementation nevertheless exhausts every safe marker.
  return "";
}

function isTerminalControl(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}
