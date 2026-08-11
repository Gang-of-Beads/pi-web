import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FileSafeTunnelStateStorage,
  createDefaultSafeTunnelState,
  defaultSafeTunnelStatePath,
  discoverLegacySafeTunnelStatePath,
  normalizeSafeTunnelControlApiBaseUrl,
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

  it("discovers the read-only legacy state import on POSIX and Windows", () => {
    expect(discoverLegacySafeTunnelStatePath({
      env: { XDG_CONFIG_HOME: "/config" },
      homeDirectory: "/home/pi",
      platform: "linux",
    })).toBe("/config/pi-web-tunnel/config.json");
    expect(discoverLegacySafeTunnelStatePath({
      env: { APPDATA: "C:\\Users\\pi\\AppData\\Roaming" },
      homeDirectory: "C:\\Users\\pi",
      platform: "win32",
    })).toBe("C:\\Users\\pi\\AppData\\Roaming\\pi-web-tunnel\\config.json");
  });
});

describe("Safe Tunnel Control API URL policy", () => {
  it.each([
    ["production HTTPS", "https://control.example.test/", "https://control.example.test"],
    ["IPv4 loopback development", "http://127.1:8787/", "http://127.0.0.1:8787"],
    ["IPv6 loopback development", "http://[0:0:0:0:0:0:0:1]:8787", "http://[::1]:8787"],
  ])("accepts %s endpoints", (_label, input, expected) => {
    expect(normalizeSafeTunnelControlApiBaseUrl(input)).toBe(expected);
  });

  it.each([
    "http://control.example.test",
    "http://localhost:8787",
    "http://127.example.test:8787",
    "http://0.0.0.0:8787",
    "http://192.168.1.10:8787",
  ])("rejects non-HTTPS non-literal-loopback endpoint %s", (controlApiBaseUrl) => {
    expect(() => normalizeSafeTunnelControlApiBaseUrl(controlApiBaseUrl))
      .toThrow("must use https");
  });
});

describe("FileSafeTunnelStateStorage", () => {
  it("defaults durable intent to disabled without creating state", async () => {
    const filePath = join(tempDirectory, "data", "safe-tunnel", "config.json");
    const storage = new FileSafeTunnelStateStorage({
      filePath,
      legacyImportPath: join(tempDirectory, "missing-legacy.json"),
      platform: "linux",
    });

    await expect(storage.load()).resolves.toEqual({
      exists: false,
      state: createDefaultSafeTunnelState(),
    });
    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("atomically persists private credentials and independent disabled intent", async () => {
    const filePath = join(tempDirectory, "data", "safe-tunnel", "config.json");
    const storage = new FileSafeTunnelStateStorage({
      filePath,
      legacyImportPath: join(tempDirectory, "missing-legacy.json"),
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

  it("preserves accepted opaque bearer credentials byte-for-byte", async () => {
    const filePath = join(tempDirectory, "data", "safe-tunnel", "config.json");
    const storage = new FileSafeTunnelStateStorage({
      filePath,
      legacyImportPath: join(tempDirectory, "missing-legacy.json"),
      platform: "linux",
    });
    const machineToken = "AbC-._~+/==";

    await storage.save({
      ...createDefaultSafeTunnelState(),
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        machineId: "machine_exact",
        machineToken,
      },
    });

    expect((await storage.load()).state.machine?.machineToken).toBe(machineToken);
    const persisted: unknown = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted).toMatchObject({ machine: { machineToken } });
  });

  it.each([
    ["mixed-case percent escapes", "%74ok%2b%2F%3d"],
    ["percent-encoded unreserved bytes", "%74%6F%6b%2B%2f%3D"],
    ["JSON Unicode escapes", "\\u0074\\u006F\\u006b\\u002B\\/\\u003d"],
  ])("rejects a %s credential alias before state persistence", async (
    _label,
    machineId,
  ) => {
    const filePath = join(tempDirectory, "data", "safe-tunnel", "config.json");
    const storage = new FileSafeTunnelStateStorage({
      filePath,
      legacyImportPath: join(tempDirectory, "missing-legacy.json"),
      platform: "linux",
    });

    await expect(storage.save({
      ...createDefaultSafeTunnelState(),
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        machineId,
        machineToken: "tok+/=",
      },
    })).rejects.toThrow("must not contain credential material");
    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("migrates PI WEB-owned v1 state without losing intent or credentials", async () => {
    const filePath = join(tempDirectory, "data", "safe-tunnel", "config.json");
    await mkdir(join(tempDirectory, "data", "safe-tunnel"), { recursive: true });
    await writeFile(filePath, JSON.stringify({
      stateVersion: 1,
      schemaVersion: 2,
      desiredState: "enabled",
      localPiWebUrl: "http://127.0.0.1:9000",
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        credentialStatus: "rejected",
        machineId: "machine_v1",
        machineToken: "piwt_mtok_v1_preserved",
      },
    }));
    const storage = new FileSafeTunnelStateStorage({
      filePath,
      legacyImportPath: join(tempDirectory, "missing-legacy.json"),
      platform: "linux",
    });

    const loaded = await storage.load();

    expect(loaded.state).toMatchObject({
      stateVersion: 2,
      desiredState: "enabled",
      localPiWebUrl: "http://127.0.0.1:9000",
      machine: {
        credentialStatus: "rejected",
        machineId: "machine_v1",
        machineToken: "piwt_mtok_v1_preserved",
      },
    });
    const migrated: unknown = JSON.parse(await readFile(filePath, "utf8"));
    expect(migrated).toMatchObject({ stateVersion: 2 });
    expect(migrated).not.toHaveProperty("schemaVersion");
  });

  it("safely imports legacy state once without enabling it or deleting the source", async () => {
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
      legacyImportPath: legacyPath,
      platform: "linux",
    });

    const loaded = await storage.load();

    expect(loaded).toMatchObject({
      exists: true,
      state: {
        stateVersion: 2,
        desiredState: "disabled",
        machine: {
          credentialStatus: "active",
          machineId: "machine_legacy",
          machineToken: "piwt_mtok_v1_legacy",
        },
      },
    });
    expect(await readFile(legacyPath, "utf8")).toContain("piwt_mtok_v1_legacy");
    expect(await readFile(filePath, "utf8")).toContain('"stateVersion": 2');
    expect(await readFile(filePath, "utf8")).not.toContain('"schemaVersion"');
  });

  it("prefers existing PI WEB state over the legacy import source", async () => {
    const filePath = join(tempDirectory, "data", "safe-tunnel", "config.json");
    const legacyPath = join(tempDirectory, "legacy.json");
    const storage = new FileSafeTunnelStateStorage({ filePath, legacyImportPath: legacyPath });
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

  it("rejects legacy plaintext non-loopback credentials before they can be used", () => {
    expect(() => parseSafeTunnelState({
      stateVersion: 2,
      desiredState: "enabled",
      localPiWebUrl: "http://127.0.0.1:8504",
      machine: {
        controlApiBaseUrl: "http://provider.example.test",
        machineId: "machine_123",
        machineToken: "private",
      },
    })).toThrow("must use https");
  });

  it.each([
    ["empty", ""],
    ["leading whitespace", " token"],
    ["trailing whitespace", "token "],
    ["embedded whitespace", "two words"],
    ["line break", "line\nbreak"],
    ["C0 control", `token${String.fromCharCode(0)}`],
    ["DEL control", `token${String.fromCharCode(127)}`],
    ["non-ASCII", "tóken"],
    ["embedded padding", "token=value"],
    ["oversized", "x".repeat(4_097)],
  ])("rejects %s machine bearer credentials without normalization", (_label, machineToken) => {
    expect(() => parseSafeTunnelState({
      stateVersion: 2,
      desiredState: "enabled",
      localPiWebUrl: "http://127.0.0.1:8504",
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        machineId: "machine_123",
        machineToken,
      },
    })).toThrow("HTTP-header-safe bearer credential");
  });

  it("parses durable rejected-credential state and rejects unknown credential states", () => {
    expect(parseSafeTunnelState({
      stateVersion: 2,
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
      stateVersion: 2,
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
      stateVersion: 2,
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
        stateVersion: 2,
        desiredState: "sometimes",
        localPiWebUrl: "http://127.0.0.1:8504",
        machine: { machineToken: secret },
      });
    } catch (error: unknown) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
