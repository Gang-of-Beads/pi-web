import { Buffer } from "node:buffer";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { parse, stringify, type TomlTable } from "smol-toml";
import { areSafeTunnelPublicValuesSeparatedFromCredentials } from "./safeTunnelDiagnostics.js";
import { normalizeSafeTunnelLocalPiWebUrl } from "./safeTunnelState.js";

const maximumFrpcConfigCharacters = 32_000;
const minimumFrpcSecretCharacters = 32;
const maximumFrpcSecretCharacters = 4_096;
const maximumFrpcNameCharacters = 253;
const maximumFrpcPathCharacters = 4_096;

const rootKeys = new Set(["auth", "proxies", "serverAddr", "serverPort", "transport"]);
const authKeys = new Set(["method", "token"]);
const transportKeys = new Set(["tls"]);
const providerTlsKeys = new Set(["enable"]);
const preparedTlsKeys = new Set(["enable", "serverName", "trustedCaFile"]);
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

export interface SafeTunnelFrpcTransportTrust {
  /** Absolute PI WEB-owned CA bundle path; provider TOML never selects this path. */
  readonly trustedCaFile: string;
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
  trust: SafeTunnelFrpcTransportTrust,
): string {
  if (input.frpcConfigToml.length > maximumFrpcConfigCharacters) throw invalidConfig();
  assertNoFrpcTemplateActions(input.frpcConfigToml);
  const trustedCaFile = requireTrustedCaFile(trust.trustedCaFile);

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
      // The provider can require TLS but cannot choose a local trust path or a
      // certificate identity. PI WEB binds those below to its own CA bundle
      // and the validated relay endpoint.
      assertOnlyKeys(tls, providerTlsKeys);
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
      tls: {
        enable: true,
        serverName: serverAddr,
        trustedCaFile,
      },
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
  inspectSafeTunnelFrpcConfigSecurity(prepared, trust);
  return prepared;
}

export interface SafeTunnelFrpcConfigSecurity {
  readonly credentialValues: readonly string[];
  /** Every generated non-credential value rendered as classification text. */
  readonly nonSecretValues: readonly string[];
}

/**
 * Revalidates and classifies the complete generated child-process boundary.
 * This keeps injected config providers from removing/repointing relay trust or
 * reusing credentials in generated DNS, TLS, proxy, target, or path channels.
 */
export function inspectSafeTunnelFrpcConfigSecurity(
  toml: string,
  trust: SafeTunnelFrpcTransportTrust,
): SafeTunnelFrpcConfigSecurity {
  if (toml.length > maximumFrpcConfigCharacters) throw invalidConfig();
  assertNoFrpcTemplateActions(toml);

  let parsed: TomlTable;
  try {
    parsed = parse(toml);
  } catch {
    throw invalidConfig();
  }

  assertOnlyKeys(parsed, rootKeys);
  const serverAddr = requireServerAddress(parsed["serverAddr"]);
  const serverPort = requirePort(parsed["serverPort"]);

  const auth = requireTable(parsed["auth"]);
  assertOnlyKeys(auth, authKeys);
  if (auth["method"] !== "token") throw invalidConfig();
  const credential = requireFrpcCredential(auth["token"]);

  const transport = requireTable(parsed["transport"]);
  assertOnlyKeys(transport, transportKeys);
  const tls = requireTable(transport["tls"]);
  assertOnlyKeys(tls, preparedTlsKeys);
  const serverName = requireServerAddress(tls["serverName"]);
  const trustedCaFile = requireTrustedCaFile(tls["trustedCaFile"]);
  if (tls["enable"] !== true
    || serverName !== serverAddr
    || trustedCaFile !== requireTrustedCaFile(trust.trustedCaFile)) {
    throw invalidConfig();
  }

  const proxies = parsed["proxies"];
  if (!Array.isArray(proxies) || proxies.length !== 1) throw invalidConfig();
  const proxy = requireTable(proxies[0]);
  assertOnlyKeys(proxy, proxyKeys);
  const proxyName = requireBoundedString(proxy["name"], maximumFrpcNameCharacters);
  if (proxy["type"] !== "http") throw invalidConfig();
  const localIP = requireServerAddress(proxy["localIP"]);
  const localPort = requirePort(proxy["localPort"]);
  const customDomains = proxy["customDomains"];
  if (!Array.isArray(customDomains) || customDomains.length !== 1) throw invalidConfig();
  const publicHostname = requireHostname(customDomains[0]);
  if (publicHostname !== customDomains[0]) throw invalidConfig();

  const credentialValues = [credential];
  const nonSecretValues = [
    "",
    ...rootKeys,
    ...authKeys,
    ...transportKeys,
    ...preparedTlsKeys,
    ...proxyKeys,
    "auth.method",
    "auth.token",
    "transport.tls.enable",
    "transport.tls.serverName",
    "transport.tls.trustedCaFile",
    "[[proxies]]",
    publicFrpcConfig(parsed, auth),
    ...networkIdentityClassificationValues(serverAddr),
    serverPort.toString(),
    "token",
    ...networkIdentityClassificationValues(serverName),
    "true",
    trustedCaFile,
    proxyName,
    "http",
    ...networkIdentityClassificationValues(localIP),
    localPort.toString(),
    publicHostname,
  ];
  if (!areSafeTunnelPublicValuesSeparatedFromCredentials(
    nonSecretValues,
    credentialValues,
  )) throw invalidConfig();
  return { credentialValues, nonSecretValues };
}

function publicFrpcConfig(parsed: TomlTable, auth: TomlTable): string {
  return stringify({
    ...parsed,
    auth: { ...auth, token: "" },
  });
}

export function safeTunnelFrpcConfigCredentials(
  toml: string,
  trust: SafeTunnelFrpcTransportTrust,
): readonly string[] {
  return inspectSafeTunnelFrpcConfigSecurity(toml, trust).credentialValues;
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

function networkIdentityClassificationValues(value: string): readonly string[] {
  const family = isIP(value);
  if (family === 4) {
    const bytes = value.split(".").map((part) => Number.parseInt(part, 10));
    return [value, Buffer.from(bytes).toString("hex")];
  }
  if (family === 6) return [value, expandIpv6Hex(value)];
  return [value];
}

function expandIpv6Hex(value: string): string {
  const halves = value.toLowerCase().split("::");
  if (halves.length > 2) throw invalidConfig();
  const left = ipv6Groups(halves[0] ?? "");
  const right = halves.length === 2 ? ipv6Groups(halves[1] ?? "") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0)
    || (halves.length === 2 && missing < 1)) throw invalidConfig();
  return [...left, ...Array<string>(missing).fill("0000"), ...right].join("");
}

function ipv6Groups(value: string): readonly string[] {
  if (value === "") return [];
  const parts = value.split(":");
  const last = parts.at(-1);
  if (last?.includes(".") === true) {
    if (isIP(last) !== 4) throw invalidConfig();
    const bytes = last.split(".").map((part) => Number.parseInt(part, 10));
    parts.splice(
      parts.length - 1,
      1,
      ((bytes[0] ?? 0) * 256 + (bytes[1] ?? 0)).toString(16),
      ((bytes[2] ?? 0) * 256 + (bytes[3] ?? 0)).toString(16),
    );
  }
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) throw invalidConfig();
  return parts.map((part) => part.padStart(4, "0"));
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
    || !isVisibleAscii(value)) throw invalidConfig();
  return value;
}

function requireTrustedCaFile(value: unknown): string {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > maximumFrpcPathCharacters
    || !isAbsolute(value)
    || hasTerminalControl(value)) throw invalidConfig();
  return value;
}

function assertNoFrpcTemplateActions(value: string): void {
  if (value.includes("{{")) throw invalidConfig();
}

function isVisibleAscii(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x21 || codePoint > 0x7e) return false;
  }
  return true;
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
