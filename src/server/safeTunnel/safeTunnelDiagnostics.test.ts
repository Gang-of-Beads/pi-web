import { describe, expect, it } from "vitest";
import {
  containsSafeTunnelSensitiveRepresentation,
  redactSafeTunnelDiagnostic,
  SafeTunnelStreamingDiagnosticRedactor,
} from "./safeTunnelDiagnostics.js";

const credential = "tok+/=";

function formValue(value: string): string {
  return new URLSearchParams([["value", value]])
    .toString()
    .slice("value=".length);
}

describe("Safe Tunnel sensitive representations", () => {
  it.each([
    ["direct", credential],
    ["form", formValue(credential)],
    ["mixed-case percent escapes", "%74ok%2b%2F%3d"],
    ["percent-encoded unreserved bytes", "%74%6F%6b%2B%2f%3D"],
    ["JSON Unicode and slash escapes", "\\u0074\\u006F\\u006b\\u002B\\/\\u003d"],
    ["mixed JSON escapes", "t\\u006fk\\u002b\\/="],
  ])("detects and redacts a %s alias", (_label, alias) => {
    expect(containsSafeTunnelSensitiveRepresentation(alias, [credential])).toBe(true);

    const redacted = redactSafeTunnelDiagnostic(`before ${alias} after`, [credential]);

    expect(redacted).toContain("before ");
    expect(redacted).toContain(" after");
    expect(redacted).not.toContain(alias);
    expect(containsSafeTunnelSensitiveRepresentation(redacted, [credential])).toBe(false);
  });

  it("accepts percent escapes for every token68 byte and either hex case", () => {
    const token68 = "AZaz09-._~+/=";
    const alias = Array.from(token68).map((character, index) => {
      const hex = character.charCodeAt(0).toString(16).padStart(2, "0");
      return `%${index % 2 === 0 ? hex.toUpperCase() : hex.toLowerCase()}`;
    }).join("");

    expect(containsSafeTunnelSensitiveRepresentation(alias, [token68])).toBe(true);
    expect(redactSafeTunnelDiagnostic(alias, [token68])).toBe("█");
  });

  it("recognizes URL form plus encoding for a private value containing a space", () => {
    const privateValue = "opaque value";
    const alias = formValue(privateValue);

    expect(alias).toContain("+");
    expect(containsSafeTunnelSensitiveRepresentation(alias, [privateValue])).toBe(true);
    expect(redactSafeTunnelDiagnostic(alias, [privateValue])).toBe("█");
  });

  it.each([
    ["mixed percent", "%74ok%2b%2F%3d"],
    ["JSON Unicode", "\\u0074\\u006F\\u006b\\u002B\\/\\u003d"],
  ])("redacts a %s alias split at every streaming boundary", (_label, alias) => {
    const redactor = new SafeTunnelStreamingDiagnosticRedactor([credential]);
    const output = Array.from(alias).map((character) => redactor.write(character)).join("")
      + redactor.flush();

    expect(output).not.toContain(alias);
    expect(output).toContain("█");
    expect(containsSafeTunnelSensitiveRepresentation(output, [credential])).toBe(false);
  });

  it("bounds streaming carry by representation size rather than log volume", () => {
    const boundedCredential = "z".repeat(4_096);
    const harmlessLog = "x".repeat(40_000);
    const redactor = new SafeTunnelStreamingDiagnosticRedactor([boundedCredential]);

    const stable = redactor.write(harmlessLog);
    const complete = stable + redactor.flush();

    expect(stable.length).toBeGreaterThan(10_000);
    expect(complete).toBe(harmlessLog);
  });
});
