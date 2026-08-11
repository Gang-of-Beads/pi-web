import { isIP } from "node:net";
import { parse, stringify, type TomlTable } from "smol-toml";
import { normalizeSafeTunnelLocalPiWebUrl } from "./safeTunnelState.js";

const maximumFrpcConfigCharacters = 32_000;
const minimumFrpcSecretCharacters = 4;
const maximumFrpcSecretCharacters = 4_096;
const maximumFrpcNameCharacters = 253;

const rootKeys = new Set(["auth", "proxies", "serverAddr", "serverPort", "transport"]);
const authKeys = new Set(["method", "token"]);
const transportKeys = new Set(["tls"]);
const tlsKeys = new Set(["enable"]);
const proxyKeys = new Set([
  "customDomains",
  "localIP",
  "localPort",
  "name",
  "type",
]);

export interface SafeTunnelFrpcConfigInput {
  readonly frpcConfigToml: string;
  readonly localPiWebUrl: string;
  readonly proxyName: string;
  readonly publicHostname: string;
}

/**
 * Treat provider TOML as an untrusted transport shape. Only the minimal frpc
 * client contract PI WEB needs is retained, and the sole proxy's local target
 * is generated from PI WEB-owned desired state rather than copied from the
 * provider response.
 */
export function prepareSafeTunnelFrpcConfig(
  input: SafeTunnelFrpcConfigInput,
  desiredLocalPiWebUrl: string,
): string {
  if (input.frpcConfigToml.length > maximumFrpcConfigCharacters) throw invalidConfig();
  assertNoFrpcTemplateActions(input.frpcConfigToml);

  let parsed: TomlTable;
  try {
    parsed = parse(input.frpcConfigToml);
  } catch {
    throw invalidConfig();
  }

  assertOnlyKeys(parsed, rootKeys);
  const serverAddr = requireServerAddress(parsed["serverAddr"]);
  const serverPort = requirePort(parsed["serverPort"]);
  const auth = requireTable(parsed["auth"]);
  assertOnlyKeys(auth, authKeys);
  const authMethod = auth["method"] === undefined
    ? "token"
    : requireBoundedString(auth["method"], maximumFrpcNameCharacters);
  if (authMethod !== "token") throw invalidConfig();
  const authToken = requireFrpcCredential(auth["token"]);

  const transport = parsed["transport"] === undefined
    ? undefined
    : requireTable(parsed["transport"]);
  if (transport !== undefined) {
    assertOnlyKeys(transport, transportKeys);
    const tls = transport["tls"] === undefined ? undefined : requireTable(transport["tls"]);
    if (tls !== undefined) {
      assertOnlyKeys(tls, tlsKeys);
      if (tls["enable"] !== undefined && tls["enable"] !== true) throw invalidConfig();
    }
  }

  const proxies = parsed["proxies"];
  if (!Array.isArray(proxies) || proxies.length !== 1) throw invalidConfig();
  const proxy = requireTable(proxies[0]);
  assertOnlyKeys(proxy, proxyKeys);
  const proxyName = requireBoundedString(proxy["name"], maximumFrpcNameCharacters);
  if (proxyName !== input.proxyName || proxy["type"] !== "http") throw invalidConfig();

  const publicHostname = requireHostname(input.publicHostname);
  const customDomains = proxy["customDomains"];
  if (!Array.isArray(customDomains)
    || customDomains.length !== 1
    || customDomains[0] !== publicHostname) throw invalidConfig();

  const providerTarget = localTarget(input.localPiWebUrl);
  if (proxy["localIP"] !== providerTarget.localIP
    || proxy["localPort"] !== providerTarget.localPort) throw invalidConfig();
  const desiredTarget = localTarget(desiredLocalPiWebUrl);

  const prepared = stringify({
    serverAddr,
    serverPort,
    auth: {
      method: "token",
      token: authToken,
    },
    transport: {
      tls: { enable: true },
    },
    proxies: [{
      name: proxyName,
      type: "http",
      localIP: desiredTarget.localIP,
      localPort: desiredTarget.localPort,
      customDomains: [publicHostname],
    }],
  });
  // frpc renders Go templates before parsing TOML. Check the serialized output
  // too, so TOML escapes cannot turn into executable template actions here.
  assertNoFrpcTemplateActions(prepared);
  return prepared;
}

/** Extracts credentials from PI WEB's prepared config for diagnostic redaction. */
export function safeTunnelFrpcConfigCredentials(toml: string): readonly string[] {
  if (toml.length > maximumFrpcConfigCharacters) throw invalidConfig();
  assertNoFrpcTemplateActions(toml);

  let parsed: TomlTable;
  try {
    parsed = parse(toml);
  } catch {
    throw invalidConfig();
  }
  const auth = requireTable(parsed["auth"]);
  assertOnlyKeys(auth, authKeys);
  return [requireFrpcCredential(auth["token"])];
}

interface LocalTarget {
  readonly localIP: string;
  readonly localPort: number;
}

function localTarget(value: string): LocalTarget {
  let normalized: string;
  try {
    normalized = normalizeSafeTunnelLocalPiWebUrl(value);
  } catch {
    throw invalidConfig();
  }
  const url = new URL(normalized);
  return {
    localIP: url.hostname.replace(/^\[|\]$/gu, ""),
    localPort: Number.parseInt(url.port, 10),
  };
}

function requireServerAddress(value: unknown): string {
  const source = requireBoundedString(value, maximumFrpcNameCharacters);
  if (isIP(source) === 0 && !isDnsHostname(source)) throw invalidConfig();
  return source;
}

function requireHostname(value: unknown): string {
  const source = requireBoundedString(value, maximumFrpcNameCharacters);
  if (!isDnsHostname(source)) throw invalidConfig();
  return source;
}

function isDnsHostname(value: string): boolean {
  return value === value.toLowerCase()
    && value.length <= maximumFrpcNameCharacters
    && value.split(".").every((label) => (
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
    ));
}

function requirePort(value: unknown): number {
  if (typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 1
    || value > 65_535) throw invalidConfig();
  return value;
}

function requireBoundedString(value: unknown, maximumCharacters: number): string {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > maximumCharacters) throw invalidConfig();
  return value;
}

function requireFrpcCredential(value: unknown): string {
  if (typeof value !== "string"
    || value.length < minimumFrpcSecretCharacters
    || value.length > maximumFrpcSecretCharacters
    || hasTerminalControl(value)) throw invalidConfig();
  return value;
}

function assertNoFrpcTemplateActions(value: string): void {
  if (value.includes("{{")) throw invalidConfig();
}

function hasTerminalControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined
      || codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function requireTable(value: unknown): TomlTable {
  if (!isTable(value)) throw invalidConfig();
  return value;
}

function assertOnlyKeys(value: TomlTable, allowed: ReadonlySet<string>): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw invalidConfig();
}

function isTable(value: unknown): value is TomlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidConfig(): Error {
  return new Error("Safe Tunnel provider frpc configuration is invalid.");
}
