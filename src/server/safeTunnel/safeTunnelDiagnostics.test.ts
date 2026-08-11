import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  containsSafeTunnelSensitiveRepresentation,
  redactSafeTunnelDiagnostic,
  SafeTunnelCredentialBoundary,
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

  it.each((() => {
    const transformedCredential = "DgOqUoxc~XpE";
    const bytes = Buffer.from(transformedCredential, "utf8");
    const digest = createHash("sha256").update(bytes).digest();
    const hex = bytes.toString("hex");
    const base64url = bytes.toString("base64url");
    return [
      ["separator-inserted direct value", "DgOq-Uoxc~XpE"],
      [
        "dot-separated base64url",
        `${base64url.slice(0, 8)}.${base64url.slice(8)}`,
      ],
      ["mixed-case hex", Array.from(hex).map((character, index) => (
        index % 2 === 0 ? character.toUpperCase() : character
      )).join("")],
      ["dot-separated hex", `${hex.slice(0, 8)}.${hex.slice(8)}`],
      ["hyphen-separated hex", `${hex.slice(0, 8)}-${hex.slice(8)}`],
      ["colon-separated hex", hex.match(/.{1,4}/gu)?.join(":") ?? hex],
      ["percent-escaped hex", Array.from(hex).map((character) => (
        `%${character.charCodeAt(0).toString(16)}`
      )).join("")],
      ["percent-escaped colon-separated hex", Array.from(hex).map((character) => (
        `%${character.charCodeAt(0).toString(16)}`
      )).join(":")],
      ["base64", bytes.toString("base64")],
      ["base64url", bytes.toString("base64url")],
      ["SHA-224 hex digest", createHash("sha224").update(bytes).digest("hex")],
      ["SHA-256 hex digest", digest.toString("hex")],
      ["SHA-256 base64url digest", digest.toString("base64url")],
      ["SHA-512 digest", createHash("sha512").update(bytes).digest("hex")],
      ["SHA-512/224 digest", createHash("sha512-224").update(bytes).digest("hex")],
      ["SHA-512/256 digest", createHash("sha512-256").update(bytes).digest("hex")],
    ] as const;
  })())("detects and redacts a %s representation", (_label, alias) => {
    const transformedCredential = "DgOqUoxc~XpE";

    expect(containsSafeTunnelSensitiveRepresentation(
      `before ${alias} after`,
      [transformedCredential],
    )).toBe(true);
    expect(redactSafeTunnelDiagnostic(alias, [transformedCredential])).toBe("█");
  });

  it("detects RFC 4648 base32 aliases", () => {
    expect(containsSafeTunnelSensitiveRepresentation(
      "obzgs5tborss23lbmnugs3tffv2g623fny.relay.test",
      ["private-machine-token"],
    )).toBe(true);
  });

  it("rejects credentials learned later when they encode an already-public value", () => {
    const publicValue = "APPROVAL-CODE-1234";
    const encodedPublicValue = Buffer.from(publicValue, "utf8").toString("base64url");
    const boundary = new SafeTunnelCredentialBoundary();

    expect(boundary.classify({ publicValues: [publicValue] })).toBe(true);
    expect(boundary.classify({ credentialValues: [encodedPublicValue] })).toBe(false);
    expect(boundary.classify({ credentialValues: [`-${encodedPublicValue}-`] }))
      .toBe(false);
  });

  it("classifies empty and JSON-serialized public values", () => {
    const boundary = new SafeTunnelCredentialBoundary();
    expect(boundary.classify({ publicValues: ["", JSON.stringify("finishedAt")] }))
      .toBe(true);
    expect(boundary.classify({
      credentialValues: [createHash("sha256").update("").digest("hex")],
    })).toBe(false);
    expect(boundary.classify({
      credentialValues: [Buffer.from(JSON.stringify("finishedAt")).toString("base64url")],
    })).toBe(false);
  });

  it("retains exact private and public containment history across recreation", () => {
    const first = new SafeTunnelCredentialBoundary();
    const privateValue = "private-frps-token-0123456789abcdef";
    const futureValue = "future-private-token-0123456789abcdef";
    const privateDigest = createHash("sha256").update("4242").digest("hex");
    expect(first.classify({ credentialValues: [privateValue, privateDigest] }))
      .toBe(true);
    expect(first.classify({
      publicValues: [`provider log before ${futureValue} after`],
    })).toBe(true);
    for (let index = 0; index < 1_100; index += 1) {
      expect(first.classify({ publicValues: [`heartbeat-${index.toString()}`] }))
        .toBe(true);
    }
    for (let index = 0; index < 60; index += 1) {
      expect(first.classify({
        publicValues: [`${index.toString()}:${"x".repeat(9_000)}`],
      })).toBe(true);
    }

    const recreated = new SafeTunnelCredentialBoundary();
    expect(recreated.classify(first.classification())).toBe(true);
    expect(recreated.classify({
      publicValues: [`runtime leaked ${privateValue} after restart`],
    })).toBe(false);
    expect(recreated.classify({ publicValues: ["4242"] })).toBe(false);
    expect(recreated.classify({ credentialValues: [futureValue] })).toBe(false);
    expect(first.classification().publicValues).toHaveLength(1_161);

    const published = new SafeTunnelCredentialBoundary();
    expect(published.classify({ publicValues: ["private-machine-token"] })).toBe(true);
    const restored = new SafeTunnelCredentialBoundary();
    expect(restored.classify(published.classification())).toBe(true);
    expect(restored.classify({
      credentialValues: ["OBZGS5TBORSS23LBMNUGS3TFFV2G623FNY"],
    })).toBe(false);
  }, 15_000);

  it("fails closed when private classification exceeds its value bound", () => {
    const boundary = new SafeTunnelCredentialBoundary();

    expect(boundary.classify({
      credentialValues: Array.from(
        { length: 257 },
        (_, index) => `private-${index.toString()}`,
      ),
    })).toBe(false);
    expect(boundary.classify({
      credentialValues: ["private-after-overflow"],
      publicValues: ["safe-public-value"],
    })).toBe(true);
  });

  it("atomically rejects a digest of a credential from newly public metadata", () => {
    const privateValue = "private-machine-token";
    const digest = createHash("sha256").update(privateValue).digest("hex");
    const boundary = new SafeTunnelCredentialBoundary();

    expect(boundary.classify({ credentialValues: [privateValue] })).toBe(true);
    expect(boundary.classify({ publicValues: [`${digest}.public.example`] })).toBe(false);
    expect(boundary.classify({ publicValues: ["safe.public.example"] })).toBe(true);
  });

  it.each([
    [
      "percent escapes",
      Array.from("ab-cd_ef").map((character) => (
        `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`
      )).join(":"),
    ],
    [
      "percent-escaped separators",
      Array.from("ab-cd_ef").map((character) => (
        `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`
      )).join("%3A"),
    ],
    [
      "JSON escapes",
      Array.from("ab-cd_ef").map((character) => (
        `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
      )).join(":"),
    ],
  ])("detects separator-inserted %s when the credential contains separators", (
    _label,
    alias,
  ) => {
    expect(containsSafeTunnelSensitiveRepresentation(alias, ["ab-cd_ef"]))
      .toBe(true);
    expect(redactSafeTunnelDiagnostic(alias, ["ab-cd_ef"])).toBe("█");
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

  it.each((() => {
    const transformedCredential = "DgOqUoxc~XpE";
    const bytes = Buffer.from(transformedCredential, "utf8");
    const base64url = bytes.toString("base64url");
    return [
      ["separator-inserted direct value", "DgOq-Uoxc~XpE"],
      ["hex", bytes.toString("hex")],
      ["base64", bytes.toString("base64")],
      ["base64url", base64url],
      ["dot-separated base64url", `${base64url.slice(0, 8)}.${base64url.slice(8)}`],
      [
        "heavily dot-separated base64url",
        Array.from(base64url).join(".".repeat(100)),
      ],
      ["SHA-256 digest", createHash("sha256").update(bytes).digest("hex")],
    ] as const;
  })())("redacts a %s alias split at every streaming boundary", (_label, alias) => {
    const transformedCredential = "DgOqUoxc~XpE";
    const redactor = new SafeTunnelStreamingDiagnosticRedactor([
      transformedCredential,
    ]);
    const output = Array.from(alias).map((character) => redactor.write(character)).join("")
      + redactor.flush();

    expect(output).toBe("█");
  });

  it("bounds arbitrary separator runs without streaming an alias prefix", () => {
    const credential = "DgOqUoxc~XpE";
    const base64url = Buffer.from(credential, "utf8").toString("base64url");
    const alias = Array.from(base64url).join(".".repeat(1_500));
    const redactor = new SafeTunnelStreamingDiagnosticRedactor([credential]);
    const output = Array.from(alias)
      .map((character) => redactor.write(character))
      .join("") + redactor.flush();

    expect(output).toBe("█");
  }, 10_000);

  it("bounds streaming carry by representation size rather than log volume", () => {
    const boundedCredential = "z".repeat(4_096);
    const harmlessLog = "x".repeat(100_000);
    const redactor = new SafeTunnelStreamingDiagnosticRedactor([boundedCredential]);

    const stable = redactor.write(harmlessLog);
    const complete = stable + redactor.flush();

    expect(stable.length).toBeGreaterThan(10_000);
    expect(complete).toBe(harmlessLog);
  });
});
