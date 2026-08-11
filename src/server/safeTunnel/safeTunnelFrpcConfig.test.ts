import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import {
  prepareSafeTunnelFrpcConfig as prepareSafeTunnelFrpcConfigWithTrust,
  safeTunnelFrpcConfigCredentials,
  type SafeTunnelFrpcConfigInput,
} from "./safeTunnelFrpcConfig.js";

const frpcToken = "private-relay-token-0123456789abcdef";
const trustedCaFile = "/private/safe-tunnel/frps-roots.pem";
const trust = { trustedCaFile } as const;

function prepareSafeTunnelFrpcConfig(
  configInput: SafeTunnelFrpcConfigInput,
  desiredLocalPiWebUrl: string,
): string {
  return prepareSafeTunnelFrpcConfigWithTrust(configInput, desiredLocalPiWebUrl, trust);
}

const providerConfig = [
  'serverAddr = "relay.example.test"',
  "serverPort = 7000",
  'auth.method = "token"',
  `auth.token = ${JSON.stringify(frpcToken)}`,
  "transport.tls.enable = true",
  "",
  "[[proxies]]",
  'name = "account-machine"',
  'type = "http"',
  'localIP = "127.0.0.1"',
  "localPort = 8504",
  'customDomains = ["dev-box.ns.tunnels.pi-web.dev"]',
  "",
].join("\n");

const input = {
  frpcConfigToml: providerConfig,
  localPiWebUrl: "http://127.0.0.1:8504",
  proxyName: "account-machine",
  publicHostname: "dev-box.ns.tunnels.pi-web.dev",
} as const;

const templateAction = "{{ .Envs.PI_WEB_SERVICE_CREDENTIAL }}";
interface TemplateFieldCase {
  readonly field: string;
  readonly frpcConfigToml: string;
  readonly inputOverrides?: Partial<SafeTunnelFrpcConfigInput>;
}
const templateFieldCases: readonly TemplateFieldCase[] = [
  {
    field: "serverAddr",
    frpcConfigToml: providerConfig.replace(
      'serverAddr = "relay.example.test"',
      `serverAddr = ${JSON.stringify(templateAction)}`,
    ),
  },
  {
    field: "serverPort",
    frpcConfigToml: providerConfig.replace(
      "serverPort = 7000",
      `serverPort = ${JSON.stringify(templateAction)}`,
    ),
  },
  {
    field: "auth.method",
    frpcConfigToml: providerConfig.replace(
      'auth.method = "token"',
      `auth.method = ${JSON.stringify(templateAction)}`,
    ),
  },
  {
    field: "auth.token",
    frpcConfigToml: providerConfig.replace(
      `auth.token = ${JSON.stringify(frpcToken)}`,
      `auth.token = ${JSON.stringify(templateAction)}`,
    ),
  },
  {
    field: "transport.tls.enable",
    frpcConfigToml: providerConfig.replace(
      "transport.tls.enable = true",
      `transport.tls.enable = ${JSON.stringify(templateAction)}`,
    ),
  },
  {
    field: "proxies.name",
    frpcConfigToml: providerConfig.replace(
      'name = "account-machine"',
      `name = ${JSON.stringify(templateAction)}`,
    ),
    inputOverrides: { proxyName: templateAction },
  },
  {
    field: "proxies.type",
    frpcConfigToml: providerConfig.replace(
      'type = "http"',
      `type = ${JSON.stringify(templateAction)}`,
    ),
  },
  {
    field: "proxies.localIP",
    frpcConfigToml: providerConfig.replace(
      'localIP = "127.0.0.1"',
      `localIP = ${JSON.stringify(templateAction)}`,
    ),
  },
  {
    field: "proxies.localPort",
    frpcConfigToml: providerConfig.replace(
      "localPort = 8504",
      `localPort = ${JSON.stringify(templateAction)}`,
    ),
  },
  {
    field: "proxies.customDomains",
    frpcConfigToml: providerConfig.replace(
      'customDomains = ["dev-box.ns.tunnels.pi-web.dev"]',
      `customDomains = [${JSON.stringify(templateAction)}]`,
    ),
    inputOverrides: { publicHostname: templateAction },
  },
];

describe("prepareSafeTunnelFrpcConfig", () => {
  it("generates one bounded proxy using only PI WEB's desired local target", () => {
    const generated = prepareSafeTunnelFrpcConfig(
      input,
      "http://[::1]:19000",
    );

    expect(parse(generated)).toEqual({
      serverAddr: "relay.example.test",
      serverPort: 7000,
      auth: { method: "token", token: frpcToken },
      transport: {
        tls: {
          enable: true,
          serverName: "relay.example.test",
          trustedCaFile,
        },
      },
      proxies: [{
        name: "account-machine",
        type: "http",
        localIP: "::1",
        localPort: 19000,
        customDomains: ["dev-box.ns.tunnels.pi-web.dev"],
      }],
    });
    expect(generated).not.toContain("127.0.0.1");
  });

  it.each(templateFieldCases)(
    "rejects Go-template references in provider-controlled $field",
    ({ frpcConfigToml, inputOverrides = {} }) => {
      expect(() => prepareSafeTunnelFrpcConfig({
        ...input,
        ...inputOverrides,
        frpcConfigToml,
      }, input.localPiWebUrl)).toThrow("provider frpc configuration is invalid");
    },
  );

  it("rejects templates that could inject TOML structure after validation", () => {
    const frpcConfigToml = providerConfig.replace(
      `auth.token = ${JSON.stringify(frpcToken)}`,
      `auth.token = ${JSON.stringify(templateAction)}`,
    );
    const renderedPayload = [
      `${frpcToken}"`,
      'includes = ["/tmp/provider-owned/*.toml"]',
      "#",
    ].join("\n");

    expect(parse(frpcConfigToml.replace(templateAction, renderedPayload)))
      .toMatchObject({ includes: ["/tmp/provider-owned/*.toml"] });
    expect(() => prepareSafeTunnelFrpcConfig(
      { ...input, frpcConfigToml },
      input.localPiWebUrl,
    )).toThrow("provider frpc configuration is invalid");
  });

  it("checks the serialized boundary when TOML escapes hide a template action", () => {
    const escapedTemplateAction = "\\u007b\\u007b .Envs.PI_WEB_SERVICE_CREDENTIAL \\u007d\\u007d";
    const frpcConfigToml = providerConfig.replace(
      `auth.token = ${JSON.stringify(frpcToken)}`,
      `auth.token = "${escapedTemplateAction}"`,
    );

    expect(frpcConfigToml).not.toContain("{{");
    expect(() => prepareSafeTunnelFrpcConfig(
      { ...input, frpcConfigToml },
      input.localPiWebUrl,
    )).toThrow("provider frpc configuration is invalid");
  });

  it.each([
    ["additional proxy", `${providerConfig}\n[[proxies]]\nname = "smuggled"\ntype = "tcp"\nlocalIP = "169.254.169.254"\nlocalPort = 80\n`],
    ["include directive", providerConfig.replace(
      "\n[[proxies]]",
      '\nincludes = ["/tmp/provider-owned/*.toml"]\n\n[[proxies]]',
    )],
    ["unexpected proxy field", providerConfig.replace(
      'customDomains = ["dev-box.ns.tunnels.pi-web.dev"]',
      'customDomains = ["dev-box.ns.tunnels.pi-web.dev"]\nplugin = "static_file"',
    )],
    ["provider target mismatch", providerConfig.replace("localPort = 8504", "localPort = 22")],
    ["additional public hostname", providerConfig.replace(
      'customDomains = ["dev-box.ns.tunnels.pi-web.dev"]',
      'customDomains = ["dev-box.ns.tunnels.pi-web.dev", "admin.example.test"]',
    )],
    ["plaintext relay transport", providerConfig.replace(
      "transport.tls.enable = true",
      "transport.tls.enable = false",
    )],
    ["provider-selected CA path", providerConfig.replace(
      "transport.tls.enable = true",
      'transport.tls.enable = true\ntransport.tls.trustedCaFile = "/tmp/provider-ca.pem"',
    )],
    ["provider-selected certificate identity", providerConfig.replace(
      "transport.tls.enable = true",
      'transport.tls.enable = true\ntransport.tls.serverName = "attacker.example"',
    )],
  ])("rejects %s without retaining provider values in the error", (_label, frpcConfigToml) => {
    const secret = frpcToken;
    let observed: unknown;

    try {
      prepareSafeTunnelFrpcConfig({ ...input, frpcConfigToml }, input.localPiWebUrl);
    } catch (error: unknown) {
      observed = error;
    }

    expect(observed).toBeInstanceOf(Error);
    expect(String(observed)).toBe("Error: Safe Tunnel provider frpc configuration is invalid.");
    expect(JSON.stringify(observed) + String(observed)).not.toContain(secret);
  });

  it.each([
    ["one character", "a"],
    ["four characters", "abcd"],
    ["31 characters", "x".repeat(31)],
    ["whitespace-only material", " ".repeat(32)],
    ["non-ASCII material", "é".repeat(32)],
    ["terminal controls", `${"x".repeat(32)}\u001B[31m`],
  ])("rejects %s credentials before they can reach frpc", (_label, token) => {
    const frpcConfigToml = providerConfig.replace(
      JSON.stringify(frpcToken),
      JSON.stringify(token),
    );

    expect(() => prepareSafeTunnelFrpcConfig(
      { ...input, frpcConfigToml },
      input.localPiWebUrl,
    )).toThrow("provider frpc configuration is invalid");
  });

  it.each((() => {
    const credential = "private-relay-token-0123456789abcdef";
    const hex = Buffer.from(credential, "utf8").toString("hex");
    const digest = createHash("sha256").update(credential).digest("hex");
    const sha224 = createHash("sha224").update(credential).digest("hex");
    const base64url = Buffer.from(credential, "utf8").toString("base64url");
    return [
      ["direct credential", credential],
      [
        "dot-separated credential base64url",
        `${base64url.slice(0, 24)}.${base64url.slice(24)}`,
      ],
      ["dot-separated credential hex", `${hex.slice(0, 40)}.${hex.slice(40)}`],
      ["SHA-224 credential digest", sha224],
      ["dot-separated credential digest", `${digest.slice(0, 32)}.${digest.slice(32)}`],
    ] as const;
  })())("rejects a generated relay/TLS identity containing a %s alias", (
    _label,
    serverAddr,
  ) => {
    const frpcConfigToml = providerConfig.replace(
      "relay.example.test",
      serverAddr,
    );

    expect(() => prepareSafeTunnelFrpcConfig(
      { ...input, frpcConfigToml },
      input.localPiWebUrl,
    )).toThrow("provider frpc configuration is invalid");
  });

  it.each(["serverAddr", ""])(
    "rejects a credential derived from generated frpc structure %j",
    (publicValue) => {
      const structuralCredential = createHash("sha256")
        .update(publicValue)
        .digest("hex");
      const frpcConfigToml = providerConfig.replace(
        JSON.stringify(frpcToken),
        JSON.stringify(structuralCredential),
      );

      expect(() => prepareSafeTunnelFrpcConfig(
        { ...input, frpcConfigToml },
        input.localPiWebUrl,
      )).toThrow("provider frpc configuration is invalid");
    },
  );

  it("revalidates PI WEB-owned trust at the child-process boundary", () => {
    const generated = prepareSafeTunnelFrpcConfig(input, input.localPiWebUrl);

    expect(safeTunnelFrpcConfigCredentials(generated, trust)).toEqual([frpcToken]);
    for (const unsafe of [
      generated.replace(trustedCaFile, "/tmp/provider-ca.pem"),
      generated.replace(
        'serverName = "relay.example.test"',
        'serverName = "attacker.example"',
      ),
      generated.replace(`trustedCaFile = ${JSON.stringify(trustedCaFile)}\n`, ""),
    ]) {
      expect(() => safeTunnelFrpcConfigCredentials(unsafe, trust))
        .toThrow("provider frpc configuration is invalid");
    }
  });

  it("rejects malformed or oversized TOML before it can reach frpc", () => {
    expect(() => prepareSafeTunnelFrpcConfig({
      ...input,
      frpcConfigToml: "[[proxies]",
    }, input.localPiWebUrl)).toThrow("provider frpc configuration is invalid");
    expect(() => prepareSafeTunnelFrpcConfig({
      ...input,
      frpcConfigToml: "x".repeat(32_001),
    }, input.localPiWebUrl)).toThrow("provider frpc configuration is invalid");
  });
});
