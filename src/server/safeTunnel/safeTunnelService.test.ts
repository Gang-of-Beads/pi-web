import { describe, expect, it } from "vitest";
import type {
  SafeTunnelApprovedDeviceAuthorization,
  SafeTunnelControlPlane,
  SafeTunnelDeviceAuthorization,
  SafeTunnelDeviceAuthorizationCompletion,
  SafeTunnelHeartbeatTunnelStatus,
  SafeTunnelMachineHeartbeat,
  SafeTunnelMachineTunnelConfig,
  SafeTunnelRegisteredMachine,
} from "./safeTunnelControlPlane.js";
import {
  createDefaultSafeTunnelState,
  type LoadedSafeTunnelState,
  type SafeTunnelMachineCredentials,
  type SafeTunnelPersistedState,
  type SafeTunnelStateStorage,
} from "./safeTunnelState.js";
import {
  SafeTunnelService,
  applySafeTunnelLocalTarget,
} from "./safeTunnelService.js";

class MemorySafeTunnelStateStorage implements SafeTunnelStateStorage {
  readonly filePath = "/data/pi-web/safe-tunnel/config.json";
  readonly saves: SafeTunnelPersistedState[] = [];

  constructor(
    private current: LoadedSafeTunnelState = {
      exists: false,
      state: createDefaultSafeTunnelState(),
    },
  ) {}

  load(): Promise<LoadedSafeTunnelState> {
    return Promise.resolve(structuredClone(this.current));
  }

  save(state: SafeTunnelPersistedState): Promise<void> {
    const snapshot = structuredClone(state);
    this.saves.push(snapshot);
    this.current = { exists: true, state: snapshot };
    return Promise.resolve();
  }
}

class FakeSafeTunnelControlPlane implements SafeTunnelControlPlane {
  readonly calls: { readonly method: string; readonly input: unknown }[] = [];
  completions: SafeTunnelDeviceAuthorizationCompletion[] = [{
    kind: "approved",
    authorization: approvedAuthorization(),
  }];
  heartbeat: SafeTunnelMachineHeartbeat = machineHeartbeat();
  registration: SafeTunnelRegisteredMachine = registeredMachine();
  tunnelConfig: SafeTunnelMachineTunnelConfig = machineTunnelConfig();

  startDeviceAuthorization(input: {
    readonly controlApiBaseUrl: string;
    readonly clientVersion: string;
  }): Promise<SafeTunnelDeviceAuthorization> {
    this.calls.push({ method: "start", input });
    return Promise.resolve(startedAuthorization());
  }

  completeDeviceAuthorization(input: {
    readonly controlApiBaseUrl: string;
    readonly deviceCode: string;
  }): Promise<SafeTunnelDeviceAuthorizationCompletion> {
    this.calls.push({ method: "complete", input });
    const completion = this.completions.shift();
    return completion === undefined
      ? Promise.reject(new Error("No fake completion configured"))
      : Promise.resolve(completion);
  }

  registerMachine(input: {
    readonly controlApiBaseUrl: string;
    readonly connectorAccessToken: string;
    readonly machineName: string;
    readonly machineSlug: string;
    readonly localPiWebUrl: string;
    readonly clientVersion: string;
  }): Promise<SafeTunnelRegisteredMachine> {
    this.calls.push({ method: "register", input });
    return Promise.resolve(this.registration);
  }

  getMachineTunnelConfig(
    credentials: SafeTunnelMachineCredentials,
  ): Promise<SafeTunnelMachineTunnelConfig> {
    this.calls.push({ method: "config", input: credentials });
    return Promise.resolve(this.tunnelConfig);
  }

  recordMachineHeartbeat(
    credentials: SafeTunnelMachineCredentials,
    input: {
      readonly clientVersion: string;
      readonly tunnelStatus: SafeTunnelHeartbeatTunnelStatus;
      readonly errorMessage?: string;
    },
  ): Promise<SafeTunnelMachineHeartbeat> {
    this.calls.push({ method: "heartbeat", input: { credentials, heartbeat: input } });
    return Promise.resolve(this.heartbeat);
  }
}

function startedAuthorization(): SafeTunnelDeviceAuthorization {
  return {
    deviceCode: "piwt_dcode_v1_device",
    userCode: "ABCD-EFGH",
    verificationUri: "https://control.example.test/device",
    verificationUriComplete: "https://control.example.test/device?user_code=ABCD-EFGH",
    expiresAt: "2026-07-29T12:10:00.000Z",
    intervalSeconds: 5,
  };
}

function approvedAuthorization(): SafeTunnelApprovedDeviceAuthorization {
  return {
    accessToken: "piwt_cat_v1_access",
    expiresAt: "2026-07-29T12:15:00.000Z",
    account: { id: "account_123", publicNamespace: "ns-abc123" },
  };
}

function registeredMachine(): SafeTunnelRegisteredMachine {
  return {
    machine: {
      id: "machine_123",
      accountId: "account_123",
      name: "Dev Box",
      slug: "dev-box",
    },
    publicHostname: "dev-box.ns-abc123.tunnels.pi-web.dev",
    publicUrl: "https://dev-box.ns-abc123.tunnels.pi-web.dev",
    machineToken: "piwt_mtok_v1_private",
  };
}

function machineHeartbeat(): SafeTunnelMachineHeartbeat {
  return {
    machineId: "machine_123",
    lastSeenAt: "2026-07-29T12:05:00.000Z",
    nextHeartbeatSeconds: 30,
  };
}

function machineTunnelConfig(): SafeTunnelMachineTunnelConfig {
  return {
    machineId: "machine_123",
    publicHostname: "dev-box.ns-abc123.tunnels.pi-web.dev",
    publicUrl: "https://dev-box.ns-abc123.tunnels.pi-web.dev",
    localPiWebUrl: "http://127.0.0.1:8504",
    proxyName: "account-machine",
    frpcConfigToml: [
      "[[proxies]]",
      'localIP = "127.0.0.1"',
      "localPort = 8504",
      "",
    ].join("\n"),
  };
}

function registeredState(overrides: Partial<SafeTunnelPersistedState> = {}): LoadedSafeTunnelState {
  return {
    exists: true,
    state: {
      ...createDefaultSafeTunnelState(),
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        machineId: "machine_123",
        machineToken: "piwt_mtok_v1_private",
        machineSlug: "dev-box",
        publicUrl: "https://dev-box.ns-abc123.tunnels.pi-web.dev",
      },
      ...overrides,
    },
  };
}

describe("SafeTunnelService", () => {
  it("drives device approval and registration through the control boundary, then privately persists credentials", async () => {
    const storage = new MemorySafeTunnelStateStorage();
    const controlPlane = new FakeSafeTunnelControlPlane();
    controlPlane.completions = [
      { kind: "pending" },
      { kind: "approved", authorization: approvedAuthorization() },
    ];
    const sleeps: number[] = [];
    const progress: unknown[] = [];
    const service = new SafeTunnelService({
      controlPlane,
      stateStorage: storage,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        return Promise.resolve();
      },
    });

    const result = await service.login({
      controlApiBaseUrl: "https://control.example.test/",
      machineName: " Dev Box ",
      machineSlug: "dev-box",
      localPiWebUrl: "http://127.0.0.1:9000",
      frpcPath: "/opt/frpc",
    }, {
      onDeviceAuthorization: (authorization) => { progress.push(authorization); },
      onAuthorizationApproved: (account) => { progress.push(account); },
      onMachineRegistered: (machine) => { progress.push(machine); },
    });

    expect(sleeps).toEqual([5000]);
    expect(result.machineCredentials.machineToken).toBe("piwt_mtok_v1_private");
    expect(storage.saves).toEqual([{
      stateVersion: 1,
      schemaVersion: 2,
      desiredState: "disabled",
      localPiWebUrl: "http://127.0.0.1:9000",
      frpcPath: "/opt/frpc",
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        machineId: "machine_123",
        machineToken: "piwt_mtok_v1_private",
        machineSlug: "dev-box",
        publicUrl: "https://dev-box.ns-abc123.tunnels.pi-web.dev",
      },
    }]);
    expect(controlPlane.calls.map(({ method }) => method)).toEqual([
      "start",
      "complete",
      "complete",
      "register",
    ]);
    expect(controlPlane.calls.at(-1)?.input).toMatchObject({
      connectorAccessToken: "piwt_cat_v1_access",
      machineName: "Dev Box",
      localPiWebUrl: "http://127.0.0.1:9000",
    });
    expect(JSON.stringify(progress)).not.toContain("piwt_cat_v1_access");
    expect(JSON.stringify(progress)).not.toContain("piwt_mtok_v1_private");
  });

  it("persists enabled and disabled intent independently from any runtime observation", async () => {
    const storage = new MemorySafeTunnelStateStorage(registeredState());
    const service = new SafeTunnelService({
      controlPlane: new FakeSafeTunnelControlPlane(),
      stateStorage: storage,
    });

    await expect(service.enable("/advanced/frpc")).resolves.toMatchObject({
      desiredState: "enabled",
      frpcPath: "/advanced/frpc",
      machine: { machineId: "machine_123" },
    });
    await expect(service.disable()).resolves.toMatchObject({
      desiredState: "disabled",
      machine: { machineId: "machine_123" },
    });
    expect(storage.saves.map(({ desiredState }) => desiredState)).toEqual(["enabled", "disabled"]);
  });

  it("fetches normalized config using private credentials and applies PI WEB's local target", async () => {
    const storage = new MemorySafeTunnelStateStorage(registeredState({
      localPiWebUrl: "http://127.0.0.1:19000",
    }));
    const controlPlane = new FakeSafeTunnelControlPlane();
    const service = new SafeTunnelService({ controlPlane, stateStorage: storage });

    const config = await service.getTunnelConfig();

    expect(config.localPiWebUrl).toBe("http://127.0.0.1:19000");
    expect(config.frpcConfigToml).toContain("localPort = 19000\n");
    expect(controlPlane.calls).toEqual([{
      method: "config",
      input: registeredState().state.machine,
    }]);
  });

  it("records normalized heartbeat state with private credentials", async () => {
    const storage = new MemorySafeTunnelStateStorage(registeredState());
    const controlPlane = new FakeSafeTunnelControlPlane();
    const service = new SafeTunnelService({ controlPlane, stateStorage: storage });

    await expect(service.recordHeartbeat({
      tunnelStatus: "error",
      errorMessage: "PI WEB Safe Tunnel runtime is recovering.",
    })).resolves.toEqual(machineHeartbeat());
    expect(controlPlane.calls).toEqual([{
      method: "heartbeat",
      input: {
        credentials: registeredState().state.machine,
        heartbeat: {
          clientVersion: "pi-web-safe-tunnel/1",
          tunnelStatus: "error",
          errorMessage: "PI WEB Safe Tunnel runtime is recovering.",
        },
      },
    }]);
  });

  it("fails closed when a machine-scoped response identifies a different machine", async () => {
    const storage = new MemorySafeTunnelStateStorage(registeredState());
    const controlPlane = new FakeSafeTunnelControlPlane();
    controlPlane.tunnelConfig = { ...machineTunnelConfig(), machineId: "machine_other" };
    const service = new SafeTunnelService({ controlPlane, stateStorage: storage });

    await expect(service.getTunnelConfig()).rejects.toMatchObject({
      code: "invalid_tunnel_config",
    });

    controlPlane.heartbeat = { ...machineHeartbeat(), machineId: "machine_other" };
    await expect(service.recordHeartbeat({ tunnelStatus: "running" })).rejects.toMatchObject({
      code: "invalid_heartbeat",
    });
  });
});

describe("applySafeTunnelLocalTarget", () => {
  it("rejects config that does not contain the asserted hosted local target", () => {
    expect(() => applySafeTunnelLocalTarget({
      ...machineTunnelConfig(),
      frpcConfigToml: "[[proxies]]\nlocalPort = 9999\n",
    }, "http://127.0.0.1:19000")).toThrow("unexpected local target");
  });
});
