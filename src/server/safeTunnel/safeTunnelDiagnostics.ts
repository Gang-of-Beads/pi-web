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

/** Redacts known credentials from one complete diagnostic value. */
export function redactSafeTunnelDiagnostic(
  value: string,
  sensitiveValues: readonly string[],
): string {
  const sanitizer = new SafeTunnelTerminalTextSanitizer();
  const sanitized = `${sanitizer.write(value)}${sanitizer.flush()}`;
  const secrets = normalizeSensitiveValues(sensitiveValues);
  return redactExactValues(sanitized, secrets, redactionMarker(secrets));
}

/**
 * Streaming counterpart used for child stdout/stderr. One chronological carry
 * is shared across both streams so chunk or stream boundaries cannot split a
 * credential before it is persisted.
 */
export class SafeTunnelStreamingDiagnosticRedactor {
  private carry = "";
  private readonly marker: string;
  private readonly sanitizer = new SafeTunnelTerminalTextSanitizer();
  private readonly secrets: readonly string[];

  constructor(sensitiveValues: readonly string[]) {
    this.secrets = normalizeSensitiveValues(sensitiveValues);
    this.marker = redactionMarker(this.secrets);
  }

  write(chunk: string): string {
    this.carry += this.sanitizer.write(chunk);
    if (this.secrets.length === 0) {
      const output = this.carry;
      this.carry = "";
      return output;
    }

    const boundary = stableDiagnosticBoundary(this.carry, this.secrets);
    const stable = this.carry.slice(0, boundary);
    this.carry = this.carry.slice(boundary);
    return redactExactValues(stable, this.secrets, this.marker);
  }

  flush(): string {
    this.carry += this.sanitizer.flush();
    const output = redactExactValues(this.carry, this.secrets, this.marker);
    this.carry = "";
    return output;
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

function redactExactValues(
  value: string,
  secrets: readonly string[],
  marker: string,
): string {
  if (marker === "" && secrets.length > 0) return "";
  let redacted = value;
  for (const secret of secrets) redacted = redacted.split(secret).join(marker);
  return redacted;
}

function stableDiagnosticBoundary(value: string, secrets: readonly string[]): number {
  let carryCharacters = 0;
  for (const secret of secrets) {
    const maximumPrefixLength = Math.min(secret.length - 1, value.length);
    for (let length = maximumPrefixLength; length > carryCharacters; length -= 1) {
      if (value.endsWith(secret.slice(0, length))) {
        carryCharacters = length;
        break;
      }
    }
  }
  return value.length - carryCharacters;
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
