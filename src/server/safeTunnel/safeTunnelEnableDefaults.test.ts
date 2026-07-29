import { describe, expect, it } from "vitest";
import {
  collisionResistantMachineSlug,
  createNodeSafeTunnelEnableDefaultsProvider,
  defaultSafeTunnelControlApiBaseUrl,
  safeTunnelLocalPiWebUrlFromServerAddress,
} from "./safeTunnelEnableDefaults.js";

describe("Safe Tunnel inferred enable defaults", () => {
  it("uses the production Control API, running listener, and OS identity", () => {
    const defaults = createNodeSafeTunnelEnableDefaultsProvider({
      serverAddress: () => ({ address: "0.0.0.0", family: "IPv4", port: 8504 }),
      hostname: () => "Federico's Dev Box",
      uniqueId: () => "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    })();

    expect(defaults).toEqual({
      controlApiBaseUrl: defaultSafeTunnelControlApiBaseUrl,
      localPiWebUrl: "http://127.0.0.1:8504",
      machineName: "Federico's Dev Box",
      machineSlug: "federico-s-dev-box-a1b2c3d4",
    });
  });

  it("normalizes wildcard and IPv6 listener addresses into reachable local URLs", () => {
    expect(safeTunnelLocalPiWebUrlFromServerAddress({
      address: "::",
      family: "IPv6",
      port: 9500,
    })).toBe("http://[::1]:9500");
    expect(() => safeTunnelLocalPiWebUrlFromServerAddress({
      address: "fe80::1%lo0",
      family: "IPv6",
      port: 9500,
    })).toThrow("scoped IPv6 listener");
  });

  it("fails clearly before listening or for a socket listener", () => {
    expect(() => safeTunnelLocalPiWebUrlFromServerAddress(null)).toThrow("must be listening");
    expect(() => safeTunnelLocalPiWebUrlFromServerAddress("/tmp/pi-web.sock")).toThrow("advanced local target");
  });

  it("bounds and disambiguates inferred slugs", () => {
    const slug = collisionResistantMachineSlug("A".repeat(100), "12345678-abcd");
    expect(slug).toHaveLength(63);
    expect(slug).toMatch(/^a+-12345678$/u);
    expect(collisionResistantMachineSlug("你好", "abcdef12-abcd")).toBe("pi-web-abcdef12");
    expect(() => collisionResistantMachineSlug("dev", "short")).toThrow("collision-resistant");
  });
});
