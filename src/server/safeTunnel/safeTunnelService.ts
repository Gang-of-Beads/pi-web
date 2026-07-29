import {
  safeTunnelClientVersion,
  type SafeTunnelControlPlane,
  type SafeTunnelDeviceAuthorization,
  type SafeTunnelMachineTunnelConfig,
  type SafeTunnelRegisteredMachine,
} from "./safeTunnelControlPlane.js";
import {
  normalizeSafeTunnelControlApiBaseUrl,
  normalizeSafeTunnelLocalPiWebUrl,
  type LoadedSafeTunnelState,
  type SafeTunnelMachineCredentials,
  type SafeTunnelPersistedState,
  type SafeTunnelStateStorage,
} from "./safeTunnelState.js";

export type SafeTunnelServiceErrorCode =
  | "authorization_expired"
  | "invalid_login"
  | "invalid_tunnel_config"
  | "not_registered";

export class SafeTunnelServiceError extends Error {
  constructor(readonly code: SafeTunnelServiceErrorCode) {
    super(safeTunnelServiceErrorMessage(code));
  }
}

export interface SafeTunnelLoginInput {
  readonly controlApiBaseUrl: string;
  readonly machineName: string;
  readonly machineSlug: string;
  readonly localPiWebUrl?: string;
  readonly frpcPath?: string;
}

export interface SafeTunnelLoginObserver {
  readonly onAuthorizationApproved?: (account: {
    readonly id: string;
    readonly publicNamespace: string;
  }) => void;
  readonly onDeviceAuthorization?: (authorization: SafeTunnelDeviceAuthorization) => void;
  readonly onMachineRegistered?: (machine: {
    readonly id: string;
    readonly publicUrl: string;
  }) => void;
}

export interface SafeTunnelLoginResult {
  readonly machineCredentials: SafeTunnelMachineCredentials;
  readonly registeredMachine: SafeTunnelRegisteredMachine;
}

export interface SafeTunnelPreparedTunnelConfig extends SafeTunnelMachineTunnelConfig {
  readonly localPiWebUrl: string;
  readonly frpcConfigToml: string;
}

export interface SafeTunnelServiceDependencies {
  readonly controlPlane: SafeTunnelControlPlane;
  readonly stateStorage: SafeTunnelStateStorage;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * PI WEB-owned Safe Tunnel application boundary. It coordinates durable local
 * intent/credentials with the normalized Control API contract, but owns no
 * binary acquisition or child process behavior.
 */
export class SafeTunnelService {
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: SafeTunnelServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
  }

  get statePath(): string {
    return this.dependencies.stateStorage.filePath;
  }

  async state(): Promise<LoadedSafeTunnelState> {
    await this.mutationTail;
    return this.dependencies.stateStorage.load();
  }

  async login(
    input: SafeTunnelLoginInput,
    observer: SafeTunnelLoginObserver = {},
  ): Promise<SafeTunnelLoginResult> {
    const existing = await this.state();
    const login = normalizeLoginInput(input, existing.state);
    const started = await this.dependencies.controlPlane.startDeviceAuthorization({
      controlApiBaseUrl: login.controlApiBaseUrl,
      clientVersion: safeTunnelClientVersion,
    });
    observer.onDeviceAuthorization?.(started);

    const authorization = await this.waitForApproval(
      login.controlApiBaseUrl,
      started,
    );
    observer.onAuthorizationApproved?.(authorization.account);

    const registeredMachine = await this.dependencies.controlPlane.registerMachine({
      controlApiBaseUrl: login.controlApiBaseUrl,
      connectorAccessToken: authorization.accessToken,
      machineName: login.machineName,
      machineSlug: login.machineSlug,
      localPiWebUrl: login.localPiWebUrl,
      clientVersion: safeTunnelClientVersion,
    });
    if (registeredMachine.machine.slug !== login.machineSlug) {
      throw new SafeTunnelServiceError("invalid_login");
    }

    const machineCredentials: SafeTunnelMachineCredentials = {
      controlApiBaseUrl: login.controlApiBaseUrl,
      machineId: registeredMachine.machine.id,
      machineToken: registeredMachine.machineToken,
      machineSlug: registeredMachine.machine.slug,
      publicUrl: registeredMachine.publicUrl,
    };

    await this.mutateState((current) => ({
      ...current,
      localPiWebUrl: login.localPiWebUrl,
      machine: machineCredentials,
      ...(login.frpcPath === undefined ? {} : { frpcPath: login.frpcPath }),
    }));
    observer.onMachineRegistered?.({
      id: registeredMachine.machine.id,
      publicUrl: registeredMachine.publicUrl,
    });

    return { machineCredentials, registeredMachine };
  }

  async enable(frpcPath?: string): Promise<SafeTunnelPersistedState> {
    const normalizedFrpcPath = frpcPath === undefined
      ? undefined
      : requireNonEmptyString(frpcPath);
    return this.mutateState((current) => {
      if (current.machine === undefined) throw new SafeTunnelServiceError("not_registered");
      return {
        ...current,
        desiredState: "enabled",
        ...(normalizedFrpcPath === undefined ? {} : { frpcPath: normalizedFrpcPath }),
      };
    });
  }

  disable(): Promise<SafeTunnelPersistedState> {
    return this.mutateState((current) => ({ ...current, desiredState: "disabled" }));
  }

  async getTunnelConfig(): Promise<SafeTunnelPreparedTunnelConfig> {
    const loaded = await this.state();
    const credentials = loaded.state.machine;
    if (credentials === undefined) throw new SafeTunnelServiceError("not_registered");

    const tunnelConfig = await this.dependencies.controlPlane.getMachineTunnelConfig(credentials);
    if (tunnelConfig.machineId !== credentials.machineId) {
      throw new SafeTunnelServiceError("invalid_tunnel_config");
    }
    return applySafeTunnelLocalTarget(tunnelConfig, loaded.state.localPiWebUrl);
  }

  private async waitForApproval(
    controlApiBaseUrl: string,
    started: SafeTunnelDeviceAuthorization,
  ) {
    const expiresAtMilliseconds = Date.parse(started.expiresAt);

    for (;;) {
      const completion = await this.dependencies.controlPlane.completeDeviceAuthorization({
        controlApiBaseUrl,
        deviceCode: started.deviceCode,
      });
      if (completion.kind === "approved") return completion.authorization;

      const remainingMilliseconds = expiresAtMilliseconds - this.now().getTime();
      if (remainingMilliseconds <= 0) {
        throw new SafeTunnelServiceError("authorization_expired");
      }
      await this.sleep(Math.min(started.intervalSeconds * 1000, remainingMilliseconds));
    }
  }

  private mutateState(
    update: (current: SafeTunnelPersistedState) => SafeTunnelPersistedState,
  ): Promise<SafeTunnelPersistedState> {
    const mutation = this.mutationTail.then(async () => {
      const loaded = await this.dependencies.stateStorage.load();
      const next = update(loaded.state);
      await this.dependencies.stateStorage.save(next);
      return next;
    });
    this.mutationTail = mutation.then(() => undefined, () => undefined);
    return mutation;
  }
}

interface NormalizedSafeTunnelLoginInput {
  readonly controlApiBaseUrl: string;
  readonly machineName: string;
  readonly machineSlug: string;
  readonly localPiWebUrl: string;
  readonly frpcPath?: string;
}

function normalizeLoginInput(
  input: SafeTunnelLoginInput,
  existing: SafeTunnelPersistedState,
): NormalizedSafeTunnelLoginInput {
  let controlApiBaseUrl: string;
  let localPiWebUrl: string;
  try {
    controlApiBaseUrl = normalizeSafeTunnelControlApiBaseUrl(input.controlApiBaseUrl);
    localPiWebUrl = normalizeSafeTunnelLocalPiWebUrl(
      input.localPiWebUrl ?? existing.localPiWebUrl,
    );
  } catch {
    throw new SafeTunnelServiceError("invalid_login");
  }

  const machineName = requireNonEmptyString(input.machineName);
  const machineSlug = requireNonEmptyString(input.machineSlug);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(machineSlug)) {
    throw new SafeTunnelServiceError("invalid_login");
  }
  const frpcPath = input.frpcPath === undefined
    ? undefined
    : requireNonEmptyString(input.frpcPath);

  return {
    controlApiBaseUrl,
    machineName,
    machineSlug,
    localPiWebUrl,
    ...(frpcPath === undefined ? {} : { frpcPath }),
  };
}

export function applySafeTunnelLocalTarget(
  tunnelConfig: SafeTunnelMachineTunnelConfig,
  localPiWebUrl: string,
): SafeTunnelPreparedTunnelConfig {
  let desiredTarget: LocalPiWebTarget;
  let controlPlaneTarget: LocalPiWebTarget;
  try {
    desiredTarget = localPiWebTarget(localPiWebUrl);
    controlPlaneTarget = localPiWebTarget(tunnelConfig.localPiWebUrl);
  } catch {
    throw new SafeTunnelServiceError("invalid_tunnel_config");
  }

  if (desiredTarget.url === controlPlaneTarget.url) return tunnelConfig;

  try {
    return {
      ...tunnelConfig,
      localPiWebUrl: desiredTarget.url,
      frpcConfigToml: replaceFrpcLocalTarget(
        tunnelConfig.frpcConfigToml,
        controlPlaneTarget,
        desiredTarget,
      ),
    };
  } catch {
    throw new SafeTunnelServiceError("invalid_tunnel_config");
  }
}

interface LocalPiWebTarget {
  readonly localIP: string;
  readonly localPort: number;
  readonly url: string;
}

function localPiWebTarget(value: string): LocalPiWebTarget {
  const url = normalizeSafeTunnelLocalPiWebUrl(value);
  const parsed = new URL(url);
  return {
    localIP: parsed.hostname,
    localPort: Number.parseInt(parsed.port, 10),
    url,
  };
}

function replaceFrpcLocalTarget(
  toml: string,
  from: LocalPiWebTarget,
  to: LocalPiWebTarget,
): string {
  return replaceTomlScalar(
    replaceTomlScalar(
      toml,
      "localIP",
      JSON.stringify(from.localIP),
      JSON.stringify(to.localIP),
    ),
    "localPort",
    from.localPort.toString(),
    to.localPort.toString(),
  );
}

function replaceTomlScalar(
  toml: string,
  key: string,
  oldValue: string,
  newValue: string,
): string {
  const pattern = new RegExp(
    `(^\\s*${escapeRegExp(key)}\\s*=\\s*)${escapeRegExp(oldValue)}(\\s*(?:\\r?\\n|$))`,
    "mu",
  );
  if (!pattern.test(toml)) throw new Error("Missing local target scalar");
  return toml.replace(
    pattern,
    (_match, prefix: string, suffix: string) => `${prefix}${newValue}${suffix}`,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function requireNonEmptyString(value: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new SafeTunnelServiceError("invalid_login");
  return normalized;
}

function safeTunnelServiceErrorMessage(code: SafeTunnelServiceErrorCode): string {
  switch (code) {
    case "authorization_expired":
      return "Safe Tunnel device authorization expired before approval.";
    case "invalid_login":
      return "Safe Tunnel login settings are invalid.";
    case "invalid_tunnel_config":
      return "The Safe Tunnel service returned configuration for an unexpected local target.";
    case "not_registered":
      return "Register or log in to PI WEB Safe Tunnels first.";
  }
}
