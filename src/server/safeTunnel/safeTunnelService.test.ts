import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SafeTunnelControlPlaneError,
  type SafeTunnelApprovedDeviceAuthorization,
  type SafeTunnelControlPlane,
  type SafeTunnelDeviceAuthorization,
  type SafeTunnelDeviceAuthorizationCompletion,
  type SafeTunnelHeartbeatTunnelStatus,
  type SafeTunnelMachineHeartbeat,
  type SafeTunnelMachineTunnelConfig,
  type SafeTunnelRegisteredMachine,
} from "./safeTunnelControlPlane.js";
import { SafeTunnelCredentialBoundary } from "./safeTunnelDiagnostics.js";
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

const frpcToken = "private-relay-token-0123456789abcdef";
const trustedCaPath = "/data/pi-web/safe-tunnel/frps-roots.pem";

class MemorySafeTunnelStateStorage implements SafeTunnelStateStorage {
  readonly filePath = "/data/pi-web/safe-tunnel/config.json";
  readonly saves: SafeTunnelPersistedState[] = [];
  saveError: Error | undefined;

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
    if (this.saveError !== undefined) return Promise.reject(this.saveError);
    const snapshot = structuredClone(state);
    this.saves.push(snapshot);
    this.current = { exists: true, state: snapshot };
    return Promise.resolve();
  }
}

function expectOnlyPublicHistorySaved(
  storage: MemorySafeTunnelStateStorage,
): void {
  expect(storage.saves.length).toBeGreaterThan(0);
  expect(storage.saves.every((state) => state.machine === undefined)).toBe(true);
  expect(storage.saves.at(-1)?.credentialBoundaryPublicValues?.length)
    .toBeGreaterThan(0);
}

class FakeSafeTunnelControlPlane implements SafeTunnelControlPlane {
  readonly calls: { readonly method: string; readonly input: unknown }[] = [];
  completions: SafeTunnelDeviceAuthorizationCompletion[] = [{
    kind: "approved",
    authorization: approvedAuthorization(),
  }];
  authorization: SafeTunnelDeviceAuthorization = startedAuthorization();
  heartbeat: SafeTunnelMachineHeartbeat = machineHeartbeat();
  heartbeatError: Error | undefined;
  registration: SafeTunnelRegisteredMachine = registeredMachine();
  registrationResult: Promise<SafeTunnelRegisteredMachine> | undefined;
  tunnelConfig: SafeTunnelMachineTunnelConfig = machineTunnelConfig();
  tunnelConfigError: Error | undefined;

  startDeviceAuthorization(input: {
    readonly controlApiBaseUrl: string;
    readonly clientVersion: string;
  }): Promise<SafeTunnelDeviceAuthorization> {
    this.calls.push({ method: "start", input });
    return Promise.resolve(this.authorization);
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
    return this.registrationResult ?? Promise.resolve(this.registration);
  }

  getMachineTunnelConfig(
    credentials: SafeTunnelMachineCredentials,
  ): Promise<SafeTunnelMachineTunnelConfig> {
    this.calls.push({ method: "config", input: credentials });
    return this.tunnelConfigError === undefined
      ? Promise.resolve(this.tunnelConfig)
      : Promise.reject(this.tunnelConfigError);
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
    return this.heartbeatError === undefined
      ? Promise.resolve(this.heartbeat)
      : Promise.reject(this.heartbeatError);
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
      'customDomains = ["dev-box.ns-abc123.tunnels.pi-web.dev"]',
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
        credentialStatus: "active",
        machineId: "machine_123",
        machineToken: "piwt_mtok_v1_private",
        machineSlug: "dev-box",
        publicUrl: "https://dev-box.ns-abc123.tunnels.pi-web.dev",
      },
      ...overrides,
    },
  };
}

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("SafeTunnelService", () => {
  it("drives device approval and registration through the control boundary, then privately persists credentials", async () => {
    const storage = new MemorySafeTunnelStateStorage();
    const controlPlane = new FakeSafeTunnelControlPlane();
    controlPlane.registration = {
      ...registeredMachine(),
      publicUrl: "https://DEV-BOX.NS-ABC123.TUNNELS.PI-WEB.DEV:443/",
    };
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
      onCredentialRedactionValues: (values) => {
        progress.push({ credentialRedactionValues: values });
      },
      onDeviceAuthorization: (authorization) => { progress.push(authorization); },
      onAuthorizationApproved: () => { progress.push("approved"); },
      onMachineRegistered: () => { progress.push("registered"); },
    });

    expect(sleeps).toEqual([5000]);
    expect(result.machineCredentials.machineToken).toBe("piwt_mtok_v1_private");
    expect(result.machineCredentials.publicUrl).toBe(
      "https://dev-box.ns-abc123.tunnels.pi-web.dev",
    );
    expect(result.registeredMachine.publicUrl).toBe(
      "https://dev-box.ns-abc123.tunnels.pi-web.dev",
    );
    expect(result.credentialRedactionValues).toEqual([
      "piwt_dcode_v1_device",
      "piwt_cat_v1_access",
      "piwt_mtok_v1_private",
    ]);
    expect(storage.saves).toHaveLength(4);
    const persisted = storage.saves.at(-1);
    expect(persisted).toMatchObject({
      stateVersion: 2,
      desiredState: "disabled",
      localPiWebUrl: "http://127.0.0.1:9000",
      frpcPath: "/opt/frpc",
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        credentialStatus: "active",
        machineId: "machine_123",
        machineToken: "piwt_mtok_v1_private",
        machineSlug: "dev-box",
        publicUrl: "https://dev-box.ns-abc123.tunnels.pi-web.dev",
      },
    });
    expect(persisted?.credentialBoundaryPublicValues).toEqual(
      expect.arrayContaining([
        "ABCD-EFGH",
        "account_123",
        "machine_123",
        "https://dev-box.ns-abc123.tunnels.pi-web.dev",
      ]),
    );
    expect(persisted?.credentialBoundaryPrivateValues).toEqual(
      expect.arrayContaining([
        "piwt_dcode_v1_device",
        "piwt_cat_v1_access",
        "piwt_mtok_v1_private",
      ]),
    );
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
    expect(progress[0]).toEqual({
      credentialRedactionValues: ["piwt_dcode_v1_device"],
    });
    expect(progress[1]).toMatchObject({ userCode: "ABCD-EFGH" });
    expect(JSON.stringify(progress[1])).not.toContain('"deviceCode"');
    expect(JSON.stringify(progress)).not.toContain("piwt_cat_v1_access");
    expect(JSON.stringify(progress)).not.toContain("piwt_mtok_v1_private");
  });

  it.each([
    ["mixed-case percent escapes", "%74ok%2b%2F%3d"],
    ["percent-encoded unreserved bytes", "%74%6F%6b%2B%2f%3D"],
    ["JSON Unicode escapes", "\\u0074\\u006F\\u006b\\u002B\\/\\u003d"],
  ])("classifies a private device code and rejects its %s reflection before observers", async (
    _label,
    reflectedCode,
  ) => {
    const storage = new MemorySafeTunnelStateStorage();
    const controlPlane = new FakeSafeTunnelControlPlane();
    controlPlane.authorization = {
      ...startedAuthorization(),
      deviceCode: "tok+/=",
      userCode: reflectedCode,
    };
    const onCredentialRedactionValues = vi.fn();
    const onDeviceAuthorization = vi.fn();
    const service = new SafeTunnelService({
      controlPlane,
      stateStorage: storage,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    await expect(service.login({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
    }, {
      onCredentialRedactionValues,
      onDeviceAuthorization,
    })).rejects.toMatchObject({ code: "invalid_login" });

    expect(onCredentialRedactionValues).not.toHaveBeenCalled();
    expect(onDeviceAuthorization).not.toHaveBeenCalled();
    expect(controlPlane.calls.map(({ method }) => method)).toEqual(["start"]);
    expectOnlyPublicHistorySaved(storage);
  });

  it("rejects unsafe injected bearer credentials before use or credential persistence", async () => {
    const unsafeAccessStorage = new MemorySafeTunnelStateStorage();
    const unsafeAccessControlPlane = new FakeSafeTunnelControlPlane();
    unsafeAccessControlPlane.completions = [{
      kind: "approved",
      authorization: { ...approvedAuthorization(), accessToken: " access-token" },
    }];
    const unsafeAccessService = new SafeTunnelService({
      controlPlane: unsafeAccessControlPlane,
      stateStorage: unsafeAccessStorage,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    await expect(unsafeAccessService.login({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
    })).rejects.toThrow("HTTP-header-safe bearer credential");
    expect(unsafeAccessControlPlane.calls.map(({ method }) => method)).toEqual([
      "start",
      "complete",
    ]);
    expectOnlyPublicHistorySaved(unsafeAccessStorage);

    const unsafeMachineStorage = new MemorySafeTunnelStateStorage();
    const unsafeMachineControlPlane = new FakeSafeTunnelControlPlane();
    unsafeMachineControlPlane.registration = {
      ...registeredMachine(),
      machineToken: "machine-token\nheader",
    };
    const unsafeMachineService = new SafeTunnelService({
      controlPlane: unsafeMachineControlPlane,
      stateStorage: unsafeMachineStorage,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    await expect(unsafeMachineService.login({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
    })).rejects.toThrow("HTTP-header-safe bearer credential");
    expect(unsafeMachineControlPlane.calls.map(({ method }) => method)).toEqual([
      "start",
      "complete",
      "register",
    ]);
    expectOnlyPublicHistorySaved(unsafeMachineStorage);

    const aliasedMetadataStorage = new MemorySafeTunnelStateStorage();
    const aliasedMetadataControlPlane = new FakeSafeTunnelControlPlane();
    const accessToken = "Access-._~+/=";
    aliasedMetadataControlPlane.completions = [{
      kind: "approved",
      authorization: { ...approvedAuthorization(), accessToken },
    }];
    aliasedMetadataControlPlane.registration = {
      ...registeredMachine(),
      machine: {
        ...registeredMachine().machine,
        id: "%41ccess-._~%2b%2F%3d",
      },
    };
    const aliasedMetadataService = new SafeTunnelService({
      controlPlane: aliasedMetadataControlPlane,
      stateStorage: aliasedMetadataStorage,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    await expect(aliasedMetadataService.login({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
    })).rejects.toMatchObject({ code: "invalid_login" });
    expectOnlyPublicHistorySaved(aliasedMetadataStorage);
  });

  it.each((() => {
    const publicApprovalValue = "Approval~Code~Already~Public";
    const bytes = Buffer.from(publicApprovalValue, "utf8");
    return [
      ["directly reuses", publicApprovalValue],
      ["hex-encodes", bytes.toString("hex")],
      ["base64-encodes", bytes.toString("base64")],
      ["base64url-encodes", bytes.toString("base64url")],
      ["wraps a base64url encoding", `-${bytes.toString("base64url")}-`],
      ["SHA-256-digests", createHash("sha256").update(bytes).digest("hex")],
      ["SHA-512/224-digests", createHash("sha512-224").update(bytes).digest("hex")],
      ["SHA-512/256-digests", createHash("sha512-256").update(bytes).digest("hex")],
    ] as const;
  })())("rejects an access credential that %s prior browser metadata", async (
    _label,
    accessToken,
  ) => {
    const storage = new MemorySafeTunnelStateStorage();
    const controlPlane = new FakeSafeTunnelControlPlane();
    controlPlane.authorization = {
      ...startedAuthorization(),
      userCode: "Approval~Code~Already~Public",
    };
    controlPlane.completions = [{
      kind: "approved",
      authorization: { ...approvedAuthorization(), accessToken },
    }];
    const service = new SafeTunnelService({
      controlPlane,
      stateStorage: storage,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    await expect(service.login({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
    })).rejects.toMatchObject({ code: "invalid_login" });
    expect(controlPlane.calls.map(({ method }) => method)).toEqual(["start", "complete"]);
    expectOnlyPublicHistorySaved(storage);
  });

  it("absorbs browser classification that predates the service login phase", async () => {
    const storage = new MemorySafeTunnelStateStorage();
    const controlPlane = new FakeSafeTunnelControlPlane();
    const browserValue = "operation-public-id";
    const credentialBoundary = new SafeTunnelCredentialBoundary();
    expect(credentialBoundary.classify({ publicValues: [browserValue] })).toBe(true);
    controlPlane.completions = [{
      kind: "approved",
      authorization: {
        ...approvedAuthorization(),
        accessToken: Buffer.from(browserValue).toString("base64url"),
      },
    }];
    const service = new SafeTunnelService({
      controlPlane,
      stateStorage: storage,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    await expect(service.login({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
    }, {}, { credentialBoundary })).rejects.toMatchObject({ code: "invalid_login" });
    expect(controlPlane.calls.map(({ method }) => method)).toEqual(["start", "complete"]);
    expectOnlyPublicHistorySaved(storage);
  });

  it("carries a reused-registration browser boundary into later frps classification", async () => {
    const storage = new MemorySafeTunnelStateStorage(registeredState());
    const controlPlane = new FakeSafeTunnelControlPlane();
    const browserValue = "operation-public-identifier-1234";
    const credentialBoundary = new SafeTunnelCredentialBoundary();
    expect(credentialBoundary.classify({ publicValues: [browserValue] })).toBe(true);
    const service = new SafeTunnelService({ controlPlane, stateStorage: storage });

    await service.enable({}, { credentialBoundary });
    const frpsCredential = Buffer.from(browserValue).toString("base64url");
    controlPlane.tunnelConfig = {
      ...machineTunnelConfig(),
      frpcConfigToml: machineTunnelConfig().frpcConfigToml.replace(
        frpcToken,
        frpsCredential,
      ),
    };

    await expect(service.getTunnelConfig()).rejects.toMatchObject({
      code: "invalid_tunnel_config",
    });
  });

  it("rejects a machine credential derived from prior browser approval metadata", async () => {
    const storage = new MemorySafeTunnelStateStorage();
    const controlPlane = new FakeSafeTunnelControlPlane();
    const userCode = "Approval~Code~Already~Public";
    controlPlane.authorization = { ...startedAuthorization(), userCode };
    controlPlane.registration = {
      ...registeredMachine(),
      machineToken: createHash("sha256").update(userCode).digest("base64url"),
    };
    const service = new SafeTunnelService({
      controlPlane,
      stateStorage: storage,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    await expect(service.login({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
    })).rejects.toMatchObject({ code: "invalid_login" });
    expect(controlPlane.calls.map(({ method }) => method)).toEqual([
      "start",
      "complete",
      "register",
    ]);
    expectOnlyPublicHistorySaved(storage);
  });

  it("retains approval classification after failed registration and service restart", async () => {
    const storage = new MemorySafeTunnelStateStorage();
    const userCode = "Approval~Code~Survives~Failure";
    const firstControlPlane = new FakeSafeTunnelControlPlane();
    firstControlPlane.authorization = { ...startedAuthorization(), userCode };
    firstControlPlane.registrationResult = Promise.reject(new Error("registration failed"));
    const firstService = new SafeTunnelService({
      controlPlane: firstControlPlane,
      stateStorage: storage,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    await expect(firstService.login({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
    })).rejects.toThrow("registration failed");
    expect(storage.saves.at(-1)?.machine).toBeUndefined();

    const restartedControlPlane = new FakeSafeTunnelControlPlane();
    restartedControlPlane.completions = [{
      kind: "approved",
      authorization: {
        ...approvedAuthorization(),
        accessToken: Buffer.from(userCode, "utf8").toString("base64url"),
      },
    }];
    const restartedService = new SafeTunnelService({
      controlPlane: restartedControlPlane,
      stateStorage: storage,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    await expect(restartedService.login({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
    })).rejects.toMatchObject({ code: "invalid_login" });
    expect(restartedControlPlane.calls.map(({ method }) => method)).toEqual([
      "start",
      "complete",
    ]);
  });

  it("retains approval classification until a later frps credential is accepted", async () => {
    const storage = new MemorySafeTunnelStateStorage();
    const controlPlane = new FakeSafeTunnelControlPlane();
    const userCode = "Approval~Code~Already~Public";
    const frpsCredential = Buffer.from(userCode, "utf8").toString("base64url");
    controlPlane.authorization = { ...startedAuthorization(), userCode };
    const registrationService = new SafeTunnelService({
      controlPlane,
      stateStorage: storage,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });
    await registrationService.login({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
    });
    controlPlane.tunnelConfig = {
      ...machineTunnelConfig(),
      frpcConfigToml: machineTunnelConfig().frpcConfigToml.replace(
        frpcToken,
        frpsCredential,
      ),
    };

    const restartedService = new SafeTunnelService({ controlPlane, stateStorage: storage });
    await expect(restartedService.getTunnelConfig()).rejects.toMatchObject({
      code: "invalid_tunnel_config",
    });
  });

  it("retains generated relay identity history across a service restart", async () => {
    const relayIdentity = "relay-identity-that-was-public.example.test";
    const storage = new MemorySafeTunnelStateStorage(registeredState());
    const controlPlane = new FakeSafeTunnelControlPlane();
    controlPlane.tunnelConfig = {
      ...machineTunnelConfig(),
      frpcConfigToml: machineTunnelConfig().frpcConfigToml.replace(
        "relay.example.test",
        relayIdentity,
      ),
    };
    const firstService = new SafeTunnelService({ controlPlane, stateStorage: storage });
    await firstService.getTunnelConfig();

    const laterCredential = Buffer.from(relayIdentity, "utf8").toString("base64url");
    controlPlane.tunnelConfig = {
      ...machineTunnelConfig(),
      frpcConfigToml: machineTunnelConfig().frpcConfigToml
        .replace(frpcToken, laterCredential)
        .replace("relay.example.test", "replacement-relay.example.test"),
    };
    const restartedService = new SafeTunnelService({ controlPlane, stateStorage: storage });

    await expect(restartedService.getTunnelConfig()).rejects.toMatchObject({
      code: "invalid_tunnel_config",
    });
  });

  it("retains exact frps credential history across a service restart", async () => {
    const storage = new MemorySafeTunnelStateStorage(registeredState());
    const controlPlane = new FakeSafeTunnelControlPlane();
    const frpsCredential = createHash("sha256").update("4242").digest("hex");
    controlPlane.tunnelConfig = {
      ...machineTunnelConfig(),
      frpcConfigToml: machineTunnelConfig().frpcConfigToml.replace(
        frpcToken,
        frpsCredential,
      ),
    };
    const firstService = new SafeTunnelService({ controlPlane, stateStorage: storage });
    await firstService.getTunnelConfig();

    const restartedService = new SafeTunnelService({ controlPlane, stateStorage: storage });
    const leakedRuntimeBoundary = new SafeTunnelCredentialBoundary();
    expect(leakedRuntimeBoundary.classify({
      publicValues: [`runtime leaked ${frpsCredential} after restart`],
    })).toBe(true);
    await expect(restartedService.persistCredentialBoundary(leakedRuntimeBoundary))
      .rejects.toMatchObject({ code: "invalid_tunnel_config" });

    const derivedRuntimeBoundary = new SafeTunnelCredentialBoundary();
    expect(derivedRuntimeBoundary.classify({ publicValues: ["4242"] })).toBe(true);
    await expect(restartedService.persistCredentialBoundary(derivedRuntimeBoundary))
      .rejects.toMatchObject({ code: "invalid_tunnel_config" });
  });

  it.each((() => {
    const hostnameToken = "private-machine-token";
    const hostnameHex = Buffer.from(hostnameToken, "utf8").toString("hex");
    const ipv6Token = "0123456789abcdef";
    const ipv6Hex = Buffer.from(ipv6Token, "utf8").toString("hex");
    return [
      {
        label: "base32 relay hostname",
        machineToken: hostnameToken,
        relayAlias: "obzgs5tborss23lbmnugs3tffv2g623fny.relay.test",
      },
      {
        label: "separator-inserted direct relay hostname",
        machineToken: hostnameToken,
        relayAlias: "pri-vate-ma-chine-to-ken.relay.test",
      },
      {
        label: "hyphen-separated relay hostname",
        machineToken: hostnameToken,
        relayAlias: `${hostnameHex.match(/.{1,8}/gu)?.join("-") ?? hostnameHex}.relay.test`,
      },
      {
        label: "colon-separated IPv6 relay address",
        machineToken: ipv6Token,
        relayAlias: ipv6Hex.match(/.{1,4}/gu)?.join(":") ?? ipv6Hex,
      },
    ] as const;
  })())("rejects a machine credential encoded into a $label TLS identity", async ({
    machineToken,
    relayAlias,
  }) => {
    const storage = new MemorySafeTunnelStateStorage(registeredState({
      machine: {
        ...registeredState().state.machine ?? {
          controlApiBaseUrl: "https://control.example.test",
          credentialStatus: "active",
          machineId: "machine_123",
          machineToken,
        },
        machineToken,
      },
    }));
    const controlPlane = new FakeSafeTunnelControlPlane();
    controlPlane.tunnelConfig = {
      ...machineTunnelConfig(),
      frpcConfigToml: machineTunnelConfig().frpcConfigToml.replace(
        "relay.example.test",
        relayAlias,
      ),
    };
    const service = new SafeTunnelService({ controlPlane, stateStorage: storage });

    await expect(service.getTunnelConfig()).rejects.toMatchObject({
      code: "invalid_tunnel_config",
    });
  });

  it("bounds authorization polling by expiry without registering", async () => {
    const storage = new MemorySafeTunnelStateStorage();
    const controlPlane = new FakeSafeTunnelControlPlane();
    controlPlane.completions = [{ kind: "pending" }];
    let nowMilliseconds = Date.parse("2026-07-29T12:09:58.000Z");
    const sleeps: number[] = [];
    const service = new SafeTunnelService({
      controlPlane,
      stateStorage: storage,
      now: () => new Date(nowMilliseconds),
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        nowMilliseconds += milliseconds;
        return Promise.resolve();
      },
    });

    await expect(service.login({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
    })).rejects.toMatchObject({ code: "authorization_expired" });

    expect(sleeps).toEqual([2000]);
    expect(controlPlane.calls.map(({ method }) => method)).toEqual([
      "start",
      "complete",
    ]);
    expectOnlyPublicHistorySaved(storage);
  });

  it("rejects invalid login settings before network activity without exposing their contents", async () => {
    const controlPlane = new FakeSafeTunnelControlPlane();
    const service = new SafeTunnelService({
      controlPlane,
      stateStorage: new MemorySafeTunnelStateStorage(),
    });
    const privateInput = "https://operator:piwt_private@control.example.test";

    let observed: unknown;
    try {
      await service.login({
        controlApiBaseUrl: privateInput,
        machineName: "Dev Box",
        machineSlug: "dev-box",
      });
    } catch (error: unknown) {
      observed = error;
    }

    expect(observed).toMatchObject({ code: "invalid_login" });
    expect(JSON.stringify(observed) + String(observed)).not.toContain(privateInput);
    expect(controlPlane.calls).toEqual([]);
  });

  it("persists enabled and disabled intent independently from any runtime observation", async () => {
    const storage = new MemorySafeTunnelStateStorage(registeredState());
    const service = new SafeTunnelService({
      controlPlane: new FakeSafeTunnelControlPlane(),
      stateStorage: storage,
    });

    await expect(service.enable({
      frpcPath: "/advanced/frpc",
      localPiWebUrl: "http://127.0.0.1:9500",
    })).resolves.toMatchObject({
      desiredState: "enabled",
      frpcPath: "/advanced/frpc",
      localPiWebUrl: "http://127.0.0.1:9500",
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
    expect(config.credentialRedactionValues).toEqual([frpcToken]);
    expect(config.frpcConfigToml).toContain("localPort = 19000\n");
    expect(config.frpcConfigToml).toContain('serverName = "relay.example.test"');
    expect(config.frpcConfigToml).toContain(
      `trustedCaFile = ${JSON.stringify(trustedCaPath)}`,
    );
    expect(controlPlane.calls).toEqual([{
      method: "config",
      input: registeredState().state.machine,
    }]);
  });

  it.each([
    {
      label: "a provider-selected alternate ingress",
      overrides: {
        publicHostname: "other.ns-abc123.tunnels.pi-web.dev",
        publicUrl: "https://other.ns-abc123.tunnels.pi-web.dev",
      },
    },
    {
      label: "an alternate scheme",
      overrides: {
        publicUrl: "http://dev-box.ns-abc123.tunnels.pi-web.dev",
      },
    },
    {
      label: "an alternate effective port",
      overrides: {
        publicUrl: "https://dev-box.ns-abc123.tunnels.pi-web.dev:9443",
      },
    },
    {
      label: "a hostname inconsistent with the registered origin",
      overrides: {
        publicHostname: "other.ns-abc123.tunnels.pi-web.dev",
      },
    },
  ])("rejects tunnel config with $label", async ({ overrides }) => {
    const storage = new MemorySafeTunnelStateStorage(registeredState());
    const controlPlane = new FakeSafeTunnelControlPlane();
    controlPlane.tunnelConfig = { ...machineTunnelConfig(), ...overrides };
    const service = new SafeTunnelService({ controlPlane, stateStorage: storage });

    await expect(service.getTunnelConfig()).rejects.toMatchObject({
      code: "invalid_tunnel_config",
    });
  });

  it("rejects tunnel config when legacy registration has no public-ingress identity", async () => {
    const storage = new MemorySafeTunnelStateStorage(registeredState({
      machine: {
        controlApiBaseUrl: "https://control.example.test",
        credentialStatus: "active",
        machineId: "machine_123",
        machineToken: "piwt_mtok_v1_private",
        machineSlug: "dev-box",
      },
    }));
    const service = new SafeTunnelService({
      controlPlane: new FakeSafeTunnelControlPlane(),
      stateStorage: storage,
    });

    await expect(service.getTunnelConfig()).rejects.toMatchObject({
      code: "invalid_tunnel_config",
    });
  });

  it("rejects an frpc authentication value reused in public tunnel metadata", async () => {
    const storage = new MemorySafeTunnelStateStorage(registeredState());
    const controlPlane = new FakeSafeTunnelControlPlane();
    const credential = "frpsecret0123456789abcdef0123456789";
    const publicHostname = `${credential}.example.test`;
    const config = machineTunnelConfig();
    controlPlane.tunnelConfig = {
      ...config,
      publicHostname,
      publicUrl: `https://${publicHostname}`,
      frpcConfigToml: config.frpcConfigToml
        .replace(frpcToken, credential)
        .replace("dev-box.ns-abc123.tunnels.pi-web.dev", publicHostname),
    };
    const service = new SafeTunnelService({ controlPlane, stateStorage: storage });

    await expect(service.getTunnelConfig()).rejects.toMatchObject({
      code: "invalid_tunnel_config",
    });
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
    expect(storage.saves.at(-1)?.credentialBoundaryPublicValues).toEqual(
      expect.arrayContaining([
        "machine_123",
        "2026-07-29T12:05:00.000Z",
        "30",
      ]),
    );
  });

  it("accepts ordinary heartbeat history without probabilistic exhaustion", async () => {
    const storage = new MemorySafeTunnelStateStorage(registeredState());
    const controlPlane = new FakeSafeTunnelControlPlane();
    const service = new SafeTunnelService({ controlPlane, stateStorage: storage });

    for (let index = 0; index < 550; index += 1) {
      controlPlane.heartbeat = {
        ...machineHeartbeat(),
        lastSeenAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      };
      await expect(service.recordHeartbeat({ tunnelStatus: "running" }))
        .resolves.toEqual(controlPlane.heartbeat);
    }
    expect(storage.saves.at(-1)?.credentialBoundaryPublicValues)
      .toContain("2026-01-01T00:09:09.000Z");
  }, 20_000);

  it("persists rejected credential state when the hosted service rejects a heartbeat", async () => {
    const storage = new MemorySafeTunnelStateStorage(registeredState({ desiredState: "enabled" }));
    const controlPlane = new FakeSafeTunnelControlPlane();
    controlPlane.heartbeatError = new SafeTunnelControlPlaneError(
      "authentication_failed",
      "record_heartbeat",
    );
    const service = new SafeTunnelService({ controlPlane, stateStorage: storage });

    await expect(service.recordHeartbeat({ tunnelStatus: "running" })).rejects.toMatchObject({
      code: "authentication_failed",
    });

    expect(storage.saves.at(-1)).toMatchObject({
      desiredState: "enabled",
      machine: { credentialStatus: "rejected", machineId: "machine_123" },
    });
    await expect(service.enable()).rejects.toMatchObject({ code: "credentials_rejected" });
  });

  it("preserves terminal authentication failure when durable rejection recording fails", async () => {
    const storage = new MemorySafeTunnelStateStorage(registeredState({ desiredState: "enabled" }));
    storage.saveError = new Error("private filesystem failure");
    const controlPlane = new FakeSafeTunnelControlPlane();
    controlPlane.heartbeatError = new SafeTunnelControlPlaneError(
      "authentication_failed",
      "record_heartbeat",
    );
    const service = new SafeTunnelService({ controlPlane, stateStorage: storage });

    await expect(service.recordHeartbeat({ tunnelStatus: "running" })).rejects.toMatchObject({
      code: "authentication_failed",
    });
  });

  it("cancels device polling before registration when enablement is disabled", async () => {
    const storage = new MemorySafeTunnelStateStorage();
    const controlPlane = new FakeSafeTunnelControlPlane();
    controlPlane.completions = [{ kind: "pending" }];
    const controller = new AbortController();
    const sleepStarted = deferred();
    const service = new SafeTunnelService({
      controlPlane,
      stateStorage: storage,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
      sleep: (_milliseconds, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => { reject(new Error("cancelled")); }, { once: true });
        sleepStarted.resolve();
      }),
    });

    const login = service.login({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
    }, {}, { signal: controller.signal });
    await sleepStarted.promise;
    expect(controlPlane.calls.map(({ method }) => method)).toEqual(["start", "complete"]);
    controller.abort();

    await expect(login).rejects.toThrow("cancelled");
    expect(controlPlane.calls.map(({ method }) => method)).toEqual(["start", "complete"]);
    expectOnlyPublicHistorySaved(storage);
  });

  it("persists a successfully returned one-time registration after concurrent cancellation", async () => {
    const storage = new MemorySafeTunnelStateStorage();
    const controlPlane = new FakeSafeTunnelControlPlane();
    const registration = deferred<SafeTunnelRegisteredMachine>();
    controlPlane.registrationResult = registration.promise;
    const controller = new AbortController();
    const service = new SafeTunnelService({
      controlPlane,
      stateStorage: storage,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    const login = service.login({
      controlApiBaseUrl: "https://control.example.test",
      machineName: "Dev Box",
      machineSlug: "dev-box",
    }, {}, { signal: controller.signal });
    await vi.waitFor(() => {
      expect(controlPlane.calls.map(({ method }) => method)).toContain("register");
    });

    controller.abort();
    registration.resolve(registeredMachine());

    await expect(login).resolves.toMatchObject({
      machineCredentials: { machineId: "machine_123" },
    });
    expect(storage.saves.at(-1)).toMatchObject({
      machine: {
        machineId: "machine_123",
        machineToken: "piwt_mtok_v1_private",
      },
    });
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
  it("writes an IPv6 local target without URL brackets in frpc TOML", () => {
    const config = applySafeTunnelLocalTarget(
      machineTunnelConfig(),
      "http://[::1]:19000",
      trustedCaPath,
    );

    expect(config.localPiWebUrl).toBe("http://[::1]:19000");
    expect(config.frpcConfigToml).toContain("localIP = \"::1\"");
    expect(config.frpcConfigToml).toContain("localPort = 19000");
  });

  it("rejects config that does not contain the asserted hosted local target", () => {
    expect(() => applySafeTunnelLocalTarget({
      ...machineTunnelConfig(),
      frpcConfigToml: machineTunnelConfig().frpcConfigToml.replace(
        "localPort = 8504",
        "localPort = 9999",
      ),
    }, "http://127.0.0.1:19000", trustedCaPath)).toThrow("unexpected local target");
  });

  it("rejects provider config that smuggles another proxy even when the first target is valid", () => {
    expect(() => applySafeTunnelLocalTarget({
      ...machineTunnelConfig(),
      frpcConfigToml: `${machineTunnelConfig().frpcConfigToml}\n[[proxies]]\nname = "extra"\ntype = "tcp"\nlocalIP = "169.254.169.254"\nlocalPort = 80\n`,
    }, "http://127.0.0.1:19000", trustedCaPath)).toThrow("unexpected local target");
  });
});
