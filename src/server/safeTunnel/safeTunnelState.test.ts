import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FileSafeTunnelStateStorage,
  createDefaultSafeTunnelState,
  defaultSafeTunnelStatePath,
  discoverLegacyConnectorConfigPath,
  parseSafeTunnelState,
  safeTunnelStateDirectoryMode,
  safeTunnelStateFileMode,
} from "./safeTunnelState.js";

let tempDirectory: string;

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "pi-web-safe-tunnel-state-"));
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("Safe Tunnel state paths", () => {
  it("stores PI WEB-owned state beneath PI_WEB_DATA_DIR", () => {
    expect(defaultSafeTunnelStatePath({ PI_WEB_DATA_DIR: "./data" }, "/workspace"))
      .toBe("/workspace/data/safe-tunnel/config.json");
  });

  it("discovers the legacy connector config on POSIX and Windows", () => {
    expect(discoverLegacyConnectorConfigPath({
      env: { XDG_CONFIG_HOME: "/config" },
      homeDirectory: "/home/pi",
      platform: "linux",
    })).toBe("/config/pi-web-tunnel/config.json");
    expect(discoverLegacyConnectorConfigPath({
      env: { APPDATA: "C:\\Users\\pi\\AppData\\Roaming" },
      homeDirectory: "C:\\Users\\pi",
      platform: "win32",
    })).toBe("C:\\Users\\pi\\AppData\\Roaming\\pi-web-tunnel\\config.json");
  });
});

describe("FileSafeTunnelStateStorage", () => {
  it("atomically persists private credentials and independent disabled intent", async () => {
    const filePath = join(tempDirectory, "data", "safe-tunnel", "config.json");
    const storage = new FileSafeTunnelStateStorage({
      filePath,
      legacyConnectorConfigPath: join(tempDirectory, "missing-legacy.json"),
      platform: "linux",
    });
    const state = {
      ...createDefaultSafeTunnelState(),
      localPiWebUrl: "http://127.0.0.1:9000",
      frpcPath: "/opt/frpc",
      machine: {
        controlApiBaseUrl: "https://control.example.test/",
        machineId: "machine_123",
        machineToken: "piwt_mtok_v1_private",
        machineSlug: "dev-box",
        publicUrl: "https://dev-box.ns.tunnels.pi-web.dev",
      },
    } as const;

    await storage.save(state);

    await expect(storage.load()).resolves.toEqual({
      exists: true,
      state: {
        ...state,
        machine: {
          ...state.machine,
          controlApiBaseUrl: "https://control.example.test",
          credentialStatus: "active",
        },
      },
    });
    expect((await stat(join(tempDirectory, "data", "safe-tunnel"))).mode & 0o777)
      .toBe(safeTunnelStateDirectoryMode);
    expect((await stat(filePath)).mode & 0o777).toBe(safeTunnelStateFileMode);
    expect((await readFile(filePath, "utf8"))).toContain("piwt_mtok_v1_private");
    expect((await readFile(filePath, "utf8"))).toContain('"desiredState": "disabled"');
  });

  it("safely imports a legacy connector config once without enabling it or deleting the source", async () => {
    const filePath = join(tempDirectory, "data", "safe-tunnel", "config.json");
    const legacyPath = join(tempDirectory, "legacy", "config.json");
    await mkdir(join(tempDirectory, "legacy"), { recursive: true });
    await writeFile(legacyPath, JSON.stringify({
      schemaVersion: 2,
      localPiWebUrl: "http://127.0.0.1:8504",
      frpcPath: "/legacy/frpc",
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        machineId: "machine_legacy",
        machineToken: "piwt_mtok_v1_legacy",
        machineSlug: "legacy-box",
        publicUrl: "https://legacy-box.ns.tunnels.pi-web.dev",
      },
    }));
    const storage = new FileSafeTunnelStateStorage({
      filePath,
      legacyConnectorConfigPath: legacyPath,
      platform: "linux",
    });

    const loaded = await storage.load();

    expect(loaded).toMatchObject({
      exists: true,
      state: {
        stateVersion: 1,
        schemaVersion: 2,
        desiredState: "disabled",
        machine: {
          credentialStatus: "active",
          machineId: "machine_legacy",
          machineToken: "piwt_mtok_v1_legacy",
        },
      },
    });
    expect(await readFile(legacyPath, "utf8")).toContain("piwt_mtok_v1_legacy");
    expect(await readFile(filePath, "utf8")).toContain('"stateVersion": 1');
  });

  it("prefers existing PI WEB state over a legacy connector config", async () => {
    const filePath = join(tempDirectory, "data", "safe-tunnel", "config.json");
    const legacyPath = join(tempDirectory, "legacy.json");
    const storage = new FileSafeTunnelStateStorage({ filePath, legacyConnectorConfigPath: legacyPath });
    await storage.save({ ...createDefaultSafeTunnelState(), desiredState: "enabled" });
    await writeFile(legacyPath, JSON.stringify({
      schemaVersion: 2,
      localPiWebUrl: "http://127.0.0.1:8504",
      machine: {
        controlApiBaseUrl: "https://wrong.example.test",
        machineId: "wrong",
        machineToken: "wrong-token",
      },
    }));

    const loaded = await storage.load();

    expect(loaded.state.desiredState).toBe("enabled");
    expect(loaded.state.machine).toBeUndefined();
  });

  it("parses durable rejected-credential state and rejects unknown credential states", () => {
    expect(parseSafeTunnelState({
      stateVersion: 1,
      schemaVersion: 2,
      desiredState: "enabled",
      localPiWebUrl: "http://127.0.0.1:8504",
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        credentialStatus: "rejected",
        machineId: "machine_123",
        machineToken: "private",
      },
    }).machine?.credentialStatus).toBe("rejected");
    expect(() => parseSafeTunnelState({
      stateVersion: 1,
      schemaVersion: 2,
      desiredState: "enabled",
      localPiWebUrl: "http://127.0.0.1:8504",
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        credentialStatus: "unknown",
        machineId: "machine_123",
        machineToken: "private",
      },
    })).toThrow("credentialStatus");
  });

  it("reports malformed state without retaining credential contents in the error", () => {
    const secret = "piwt_mtok_v1_must_not_leak";
    expect(() => parseSafeTunnelState({
      stateVersion: 1,
      schemaVersion: 2,
      desiredState: "sometimes",
      localPiWebUrl: "http://127.0.0.1:8504",
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        machineId: "machine_123",
        machineToken: secret,
      },
    })).toThrow("desiredState");

    try {
      parseSafeTunnelState({
        stateVersion: 1,
        schemaVersion: 2,
        desiredState: "sometimes",
        localPiWebUrl: "http://127.0.0.1:8504",
        machine: { machineToken: secret },
      });
    } catch (error: unknown) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
