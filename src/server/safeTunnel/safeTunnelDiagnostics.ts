import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

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

/** Detects supported credential aliases after terminal sanitization. */
export function containsSafeTunnelSensitiveRepresentation(
  value: string,
  sensitiveValues: readonly string[],
): boolean {
  const sanitizer = new SafeTunnelTerminalTextSanitizer();
  const sanitized = `${sanitizer.write(value)}${sanitizer.flush()}`;
  return new SafeTunnelSensitiveRepresentationMatcher(sensitiveValues)
    .contains(sanitized);
}

/** Returns true only when the complete value is a supported sensitive alias. */
function isSafeTunnelSensitiveRepresentation(
  value: string,
  sensitiveValues: readonly string[],
): boolean {
  const sanitizer = new SafeTunnelTerminalTextSanitizer();
  const sanitized = `${sanitizer.write(value)}${sanitizer.flush()}`;
  return new SafeTunnelSensitiveRepresentationMatcher(sensitiveValues)
    .containsComplete(sanitized);
}

/**
 * Enforces both directions of the public/private boundary: public fields may
 * not contain a credential alias, and a later credential may not itself be an
 * encoded or digested spelling of a value that was already public.
 */
export function areSafeTunnelPublicValuesSeparatedFromCredentials(
  publicValues: readonly string[],
  credentialValues: readonly string[],
): boolean {
  return !publicValues.some((value) => (
    containsSafeTunnelSensitiveRepresentation(value, credentialValues)
  )) && !credentialValues.some((credential) => (
    isSafeTunnelSensitiveRepresentation(credential, publicValues)
  ));
}

/**
 * Adds one scalar stream whose substrings cover every contiguous recombination
 * while avoiding quadratic persisted history.
 */
export function withSafeTunnelContiguousPublicComposite(
  values: readonly string[],
): readonly string[] {
  const classified = new Set(values);
  if (values.length > 1) classified.add(values.join(""));
  return [...classified];
}

function arePublicValuesFreeOfCredentialAliases(
  publicValues: readonly string[],
  matcher: SafeTunnelSensitiveRepresentationMatcher,
): boolean {
  if (publicValues.length === 0 || matcher.values.length === 0) return true;
  return !publicValues.some((value) => {
    const sanitizer = new SafeTunnelTerminalTextSanitizer();
    return matcher.contains(`${sanitizer.write(value)}${sanitizer.flush()}`);
  });
}

export interface SafeTunnelCredentialClassification {
  readonly credentialValues?: readonly string[];
  readonly publicValues?: readonly string[];
}

const maximumClassifiedValues = 256;
const maximumPublicValues = 262_144;
const maximumClassifiedCharacters = 512 * 1_024;
const maximumPublicCharacters = 16 * 1_024 * 1_024;
const credentialAliasSeparators = ".:-[]";
const maximumStreamingAliasSeparatorRun = 64;

/**
 * Bounded cross-phase classification for values whose private/public role is
 * learned at different times. Updates are atomic and fail closed. Complete
 * accepted public and private values are retained so persistence preserves both
 * containment directions without probabilistic false positives.
 */
export class SafeTunnelCredentialBoundary {
  private credentialMatcher = new SafeTunnelSensitiveRepresentationMatcher([]);
  private credentialValues: readonly string[] = [];
  private publicValues: readonly string[] = [];

  classify(input: SafeTunnelCredentialClassification): boolean {
    const addedPublicValues = newClassifiedValues(
      this.publicValues,
      input.publicValues ?? [],
      true,
    );
    const addedCredentialValues = newClassifiedValues(
      this.credentialValues,
      input.credentialValues ?? [],
      false,
    );
    const publicValues = [...this.publicValues, ...addedPublicValues];
    const credentialValues = [...this.credentialValues, ...addedCredentialValues];
    const credentialMatcher = addedCredentialValues.length === 0
      ? this.credentialMatcher
      : new SafeTunnelSensitiveRepresentationMatcher(credentialValues);
    const addedCredentialMatcher = new SafeTunnelSensitiveRepresentationMatcher(
      addedCredentialValues,
    );
    if (!classificationIsBounded(
      credentialValues,
      maximumClassifiedValues,
      maximumClassifiedCharacters,
    )
      || !classificationIsBounded(
        publicValues,
        maximumPublicValues,
        maximumPublicCharacters,
      )
      || !arePublicValuesFreeOfCredentialAliases(
        addedPublicValues,
        credentialMatcher,
      )
      || !arePublicValuesFreeOfCredentialAliases(
        this.publicValues,
        addedCredentialMatcher,
      )
      || !credentialValues.every((credential) => (
        !isSafeTunnelSensitiveRepresentation(credential, addedPublicValues)
      ))
      || !addedCredentialValues.every((credential) => (
        !isSafeTunnelSensitiveRepresentation(credential, publicValues)
      ))) return false;

    this.publicValues = publicValues;
    this.credentialValues = credentialValues;
    this.credentialMatcher = credentialMatcher;
    return true;
  }

  clone(): SafeTunnelCredentialBoundary {
    const clone = new SafeTunnelCredentialBoundary();
    clone.publicValues = [...this.publicValues];
    clone.credentialValues = [...this.credentialValues];
    clone.credentialMatcher = new SafeTunnelSensitiveRepresentationMatcher(
      clone.credentialValues,
    );
    return clone;
  }

  classification(): Required<SafeTunnelCredentialClassification> {
    return {
      credentialValues: [...this.credentialValues],
      publicValues: [...this.publicValues],
    };
  }

  clear(): void {
    this.publicValues = [];
    this.credentialValues = [];
    this.credentialMatcher = new SafeTunnelSensitiveRepresentationMatcher([]);
  }
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
  private readonly separatorLimiter = new SafeTunnelAliasSeparatorRunLimiter();
  private readonly sanitizer = new SafeTunnelTerminalTextSanitizer();

  constructor(sensitiveValues: readonly string[]) {
    this.matcher = new SafeTunnelSensitiveRepresentationMatcher(sensitiveValues);
    this.marker = redactionMarker(this.matcher.values);
  }

  write(chunk: string): string {
    const sanitized = this.sanitizer.write(chunk);
    if (this.matcher.values.length === 0) return sanitized;
    const limited = this.separatorLimiter.write(sanitized);
    if (limited === "") return "";
    this.carry += limited;

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
    const sanitized = this.sanitizer.flush();
    if (this.matcher.values.length === 0) return sanitized;
    this.carry += this.separatorLimiter.write(sanitized);
    this.separatorLimiter.flush();
    const output = this.matcher.redact(this.carry, this.marker);
    this.carry = "";
    return output;
  }
}

class SafeTunnelAliasSeparatorRunLimiter {
  private runLength = 0;

  write(value: string): string {
    let output = "";
    for (const character of value) {
      if (credentialAliasSeparators.includes(character)) {
        this.runLength += 1;
        if (this.runLength <= maximumStreamingAliasSeparatorRun) output += character;
      } else {
        this.runLength = 0;
        output += character;
      }
    }
    return output;
  }

  flush(): void {
    this.runLength = 0;
  }
}

interface SensitiveRepresentation {
  readonly asciiCaseInsensitive: boolean;
  readonly ignoredSeparators: string;
  readonly serializedAliasesAllowed: boolean;
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
 * Finds direct values and bounded, deterministic aliases. Percent/form and
 * JSON decoding is applied once to every alias; canonical UTF-8 hex,
 * base64/base64url, and common digest spellings are generated explicitly.
 */
class SafeTunnelSensitiveRepresentationMatcher {
  readonly maximumRepresentationCharacters: number;
  readonly values: readonly string[];
  private readonly compactedRepresentations: readonly SensitiveRepresentation[];
  private readonly representations: readonly SensitiveRepresentation[];

  constructor(values: readonly string[]) {
    this.values = normalizeSensitiveValues(values);
    this.representations = sensitiveRepresentations(this.values);
    this.compactedRepresentations = compactSensitiveRepresentations(
      this.representations,
    );
    this.maximumRepresentationCharacters = this.representations.reduce(
      (maximum, representation) => Math.max(
        maximum,
        representation.ignoredSeparators === ""
          ? representation.text.length
          : Math.min(
              64 * 1_024,
              (representation.text.length * 128) + 128,
            ),
        ...(representation.serializedAliasesAllowed
          ? [representation.text.length * 6, representation.utf8.length * 3]
          : []),
      ),
      0,
    );
  }

  contains(value: string): boolean {
    return this.matches(value).length > 0;
  }

  containsComplete(value: string): boolean {
    return this.matches(value).some(({ start, end }) => (
      isAliasSeparatorWrapper(value.slice(0, start))
      && isAliasSeparatorWrapper(value.slice(end))
    ));
  }

  matches(value: string): readonly TextRange[] {
    if (value === "" || this.representations.length === 0) return [];

    const matches: TextRange[] = [];
    addRepresentationMatches(value, this.representations, matches);
    addSeparatorCompactedSerializedMatches(
      value,
      this.compactedRepresentations,
      matches,
    );

    if (Array.from(credentialAliasSeparators).some(
      (separator) => value.includes(separator),
    )) {
      const compacted = decodeTextWithoutSeparators(
        value,
        credentialAliasSeparators,
      );
      const compactedMatches: TextRange[] = [];
      addRepresentationMatches(
        compacted.text,
        this.compactedRepresentations,
        compactedMatches,
      );
      addMappedTextRanges(compacted, compactedMatches, matches);
    }
    return mergeRanges(matches);
  }

  redact(value: string, marker: string): string {
    if (marker === "" && this.representations.length > 0) return "";
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

function isAliasSeparatorWrapper(value: string): boolean {
  if (value === "") return true;
  const decodedValues = [
    value,
    decodePercentEncodedBytes(value, false).bytes.toString("utf8"),
    decodeJsonStringContents(value).text,
  ];
  return decodedValues.some((decoded) => decoded !== ""
    && Array.from(decoded).every(
      (character) => credentialAliasSeparators.includes(character),
    ));
}

function normalizeSensitiveValues(values: readonly string[]): readonly string[] {
  const normalized = new Set<string>();
  for (const value of values) {
    const sanitizer = new SafeTunnelTerminalTextSanitizer();
    const sanitized = `${sanitizer.write(value)}${sanitizer.flush()}`;
    if (sanitized !== "" || value === "") normalized.add(sanitized);
  }
  return [...normalized].sort((left, right) => right.length - left.length);
}

function encodeBase32(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let bitCount = 0;
  let encoded = "";
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      encoded += alphabet[(bits >>> bitCount) & 0x1f] ?? "";
    }
  }
  if (bitCount > 0) encoded += alphabet[(bits << (5 - bitCount)) & 0x1f] ?? "";
  return encoded.padEnd(Math.ceil(encoded.length / 8) * 8, "=");
}

function sensitiveRepresentations(
  values: readonly string[],
): readonly SensitiveRepresentation[] {
  const representations = new Map<string, SensitiveRepresentation>();
  const add = (
    text: string,
    asciiCaseInsensitive = false,
    ignoredSeparators = "",
    serializedAliasesAllowed = false,
  ): void => {
    if (text === "") return;
    const normalizedText = asciiCaseInsensitive ? text.toLowerCase() : text;
    const key = `${asciiCaseInsensitive ? "i" : "s"}:${normalizedText}`;
    const existing = representations.get(key);
    representations.set(key, {
      asciiCaseInsensitive,
      ignoredSeparators: Array.from(new Set(
        `${existing?.ignoredSeparators ?? ""}${ignoredSeparators}`,
      )).join(""),
      serializedAliasesAllowed: serializedAliasesAllowed
        || existing?.serializedAliasesAllowed === true,
      text: normalizedText,
      utf8: Buffer.from(normalizedText, "utf8"),
    });
  };
  const addEncodedBytes = (bytes: Buffer): void => {
    add(bytes.toString("hex"), true, credentialAliasSeparators, true);
    const base64 = bytes.toString("base64");
    add(base64, false, credentialAliasSeparators, true);
    add(
      base64.replace(/=+$/u, ""),
      false,
      credentialAliasSeparators,
      true,
    );
    const base64UrlPadded = base64.replaceAll("+", "-").replaceAll("/", "_");
    add(base64UrlPadded, false, credentialAliasSeparators, true);
    add(
      base64UrlPadded.replace(/=+$/u, ""),
      false,
      credentialAliasSeparators,
      true,
    );
    const base32 = encodeBase32(bytes);
    add(base32, true, credentialAliasSeparators, true);
    add(base32.replace(/=+$/u, ""), true, credentialAliasSeparators, true);
  };

  for (const value of values) {
    add(value, false, credentialAliasSeparators, true);
    const utf8 = Buffer.from(value, "utf8");
    addEncodedBytes(utf8);
    for (const algorithm of [
      "md5",
      "sha1",
      "sha224",
      "sha256",
      "sha384",
      "sha512",
      "sha512-224",
      "sha512-256",
    ] as const) {
      addEncodedBytes(createHash(algorithm).update(utf8).digest());
    }
  }
  return [...representations.values()].sort((left, right) => (
    right.text.length - left.text.length
  ));
}

function compactSensitiveRepresentations(
  representations: readonly SensitiveRepresentation[],
): readonly SensitiveRepresentation[] {
  const compacted = new Map<string, SensitiveRepresentation>();
  for (const representation of representations) {
    const text = Array.from(representation.text)
      .filter((character) => !credentialAliasSeparators.includes(character))
      .join("");
    if (text === "") continue;
    const key = `${representation.asciiCaseInsensitive ? "i" : "s"}:${text}`;
    const existing = compacted.get(key);
    compacted.set(key, {
      asciiCaseInsensitive: representation.asciiCaseInsensitive,
      ignoredSeparators: "",
      serializedAliasesAllowed: representation.serializedAliasesAllowed
        || existing?.serializedAliasesAllowed === true,
      text,
      utf8: Buffer.from(text, "utf8"),
    });
  }
  return [...compacted.values()].sort((left, right) => (
    right.text.length - left.text.length
  ));
}

function addRepresentationMatches(
  value: string,
  representations: readonly SensitiveRepresentation[],
  matches: TextRange[],
): void {
  for (const representation of representations) {
    addDirectMatches(value, representation, matches);
  }

  const serialized = representations.filter(
    ({ serializedAliasesAllowed }) => serializedAliasesAllowed,
  );
  addDecodedByteMatches(
    decodePercentEncodedBytes(value, false),
    serialized,
    matches,
  );
  if (serialized.some(({ text }) => text.includes(" "))) {
    addDecodedByteMatches(
      decodePercentEncodedBytes(value, true),
      serialized,
      matches,
    );
  }

  const jsonDecoded = decodeJsonStringContents(value);
  for (const representation of serialized) {
    addDecodedTextMatches(jsonDecoded, representation, matches);
  }
}

function addSeparatorCompactedSerializedMatches(
  value: string,
  compactedRepresentations: readonly SensitiveRepresentation[],
  matches: TextRange[],
): void {
  for (const formEncoded of [false, true]) {
    addDecodedByteMatches(
      decodedBytesWithoutSeparators(
        decodePercentEncodedBytes(value, formEncoded),
      ),
      compactedRepresentations,
      matches,
    );
  }

  const jsonDecoded = decodedTextWithoutSeparators(
    decodeJsonStringContents(value),
  );
  for (const representation of compactedRepresentations) {
    addDecodedTextMatches(jsonDecoded, representation, matches);
  }
}

function addMappedTextRanges(
  decoded: DecodedText,
  decodedRanges: readonly TextRange[],
  matches: TextRange[],
): void {
  for (const range of decodedRanges) {
    const start = decoded.starts[range.start];
    const end = decoded.ends[range.end - 1];
    if (start !== undefined && end !== undefined) matches.push({ start, end });
  }
}

function newClassifiedValues(
  current: readonly string[],
  additions: readonly string[],
  includeEmpty: boolean,
): readonly string[] {
  const known = new Set(current);
  const added: string[] = [];
  for (const value of additions) {
    if ((!includeEmpty && value === "") || known.has(value)) continue;
    known.add(value);
    added.push(value);
  }
  return added;
}

function classificationIsBounded(
  values: readonly string[],
  maximumValues: number,
  maximumCharacters: number,
): boolean {
  if (values.length > maximumValues) return false;
  let characters = 0;
  for (const value of values) {
    characters += value.length;
    if (characters > maximumCharacters) return false;
  }
  return true;
}

function addDirectMatches(
  value: string,
  representation: SensitiveRepresentation,
  matches: TextRange[],
): void {
  const source = representation.asciiCaseInsensitive ? value.toLowerCase() : value;
  let offset = 0;
  while (offset <= source.length - representation.text.length) {
    const start = source.indexOf(representation.text, offset);
    if (start < 0) return;
    matches.push({ start, end: start + representation.text.length });
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

function decodedBytesWithoutSeparators(decoded: DecodedBytes): DecodedBytes {
  const bytes: number[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < decoded.bytes.length; index += 1) {
    const byte = decoded.bytes[index];
    if (byte === undefined
      || credentialAliasSeparators.includes(String.fromCharCode(byte))) continue;
    bytes.push(byte);
    starts.push(decoded.starts[index] ?? 0);
    ends.push(decoded.ends[index] ?? 0);
  }
  return { bytes: Buffer.from(bytes), starts, ends };
}

function addDecodedByteMatches(
  decoded: DecodedBytes,
  representations: readonly SensitiveRepresentation[],
  matches: TextRange[],
): void {
  for (const representation of representations) {
    let offset = 0;
    while (offset <= decoded.bytes.length - representation.utf8.length) {
      const index = representation.asciiCaseInsensitive
        ? indexOfAsciiCaseInsensitive(decoded.bytes, representation.utf8, offset)
        : decoded.bytes.indexOf(representation.utf8, offset);
      if (index < 0) break;
      const lastIndex = index + representation.utf8.length - 1;
      if (isDecodedByteBoundary(decoded, index, lastIndex)) {
        const start = decoded.starts[index];
        const end = decoded.ends[lastIndex];
        if (start !== undefined && end !== undefined) matches.push({ start, end });
      }
      offset = index + 1;
    }
  }
}

function indexOfAsciiCaseInsensitive(
  value: Buffer,
  expected: Buffer,
  offset: number,
): number {
  for (let start = offset; start <= value.length - expected.length; start += 1) {
    let matches = true;
    for (let index = 0; index < expected.length; index += 1) {
      if (asciiLowercase(value[start + index] ?? -1) !== (expected[index] ?? -2)) {
        matches = false;
        break;
      }
    }
    if (matches) return start;
  }
  return -1;
}

function asciiLowercase(value: number): number {
  return value >= 0x41 && value <= 0x5a ? value + 0x20 : value;
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

function decodeTextWithoutSeparators(
  value: string,
  separators: string,
): DecodedText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (separators.includes(value[index] ?? "")) continue;
    text += value[index] ?? "";
    starts.push(index);
    ends.push(index + 1);
  }
  return { text, starts, ends };
}

function decodedTextWithoutSeparators(decoded: DecodedText): DecodedText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < decoded.text.length; index += 1) {
    const character = decoded.text[index] ?? "";
    if (credentialAliasSeparators.includes(character)) continue;
    text += character;
    starts.push(decoded.starts[index] ?? 0);
    ends.push(decoded.ends[index] ?? 0);
  }
  return { text, starts, ends };
}

function addDecodedTextMatches(
  decoded: DecodedText,
  representation: SensitiveRepresentation,
  matches: TextRange[],
): void {
  const source = representation.asciiCaseInsensitive
    ? decoded.text.toLowerCase()
    : decoded.text;
  let offset = 0;
  while (offset <= source.length - representation.text.length) {
    const index = source.indexOf(representation.text, offset);
    if (index < 0) return;
    const start = decoded.starts[index];
    const end = decoded.ends[index + representation.text.length - 1];
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
