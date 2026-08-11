import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { prepareSafeTunnelFrpcConfig } from "./safeTunnelFrpcConfig.js";

const providerConfig = [
  'serverAddr = "relay.example.test"',
  "serverPort = 7000",
  'auth.method = "token"',
  'auth.token = "private-relay-token"',
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

describe("prepareSafeTunnelFrpcConfig", () => {
  it("generates one bounded proxy using only PI WEB's desired local target", () => {
    const generated = prepareSafeTunnelFrpcConfig(
      input,
      "http://[::1]:19000",
    );

    expect(parse(generated)).toEqual({
      serverAddr: "relay.example.test",
      serverPort: 7000,
      auth: { method: "token", token: "private-relay-token" },
      transport: { tls: { enable: true } },
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
  ])("rejects %s without retaining provider values in the error", (_label, frpcConfigToml) => {
    const secret = "private-relay-token";
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
    ["two characters", "ab"],
    ["three characters", "abc"],
    ["terminal controls", "ab\u001B[31mcd"],
  ])("rejects %s credentials before they can reach frpc", (_label, token) => {
    const frpcConfigToml = providerConfig.replace(
      '"private-relay-token"',
      JSON.stringify(token),
    );

    expect(() => prepareSafeTunnelFrpcConfig(
      { ...input, frpcConfigToml },
      input.localPiWebUrl,
    )).toThrow("provider frpc configuration is invalid");
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
