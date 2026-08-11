import {
  SafeTunnelControlPlaneError,
  safeTunnelClientVersion,
  type SafeTunnelApprovedDeviceAuthorization,
  type SafeTunnelControlPlane,
  type SafeTunnelDeviceAuthorization,
  type SafeTunnelHeartbeatTunnelStatus,
  type SafeTunnelMachineHeartbeat,
  type SafeTunnelMachineTunnelConfig,
  type SafeTunnelRegisteredMachine,
} from "./safeTunnelControlPlane.js";
import {
  SafeTunnelCredentialBoundary,
  withSafeTunnelContiguousPublicComposite as withContiguousPublicComposite,
  type SafeTunnelCredentialClassification,
} from "./safeTunnelDiagnostics.js";
import {
  inspectSafeTunnelFrpcConfigSecurity,
  prepareSafeTunnelFrpcConfig,
} from "./safeTunnelFrpcConfig.js";
import { safeTunnelFrpcTrustedCaPath } from "./safeTunnelFrpcRuntimeFiles.js";
import {
  normalizeSafeTunnelControlApiBaseUrl,
  normalizeSafeTunnelLocalPiWebUrl,
  normalizeSafeTunnelPublicUrl,
  requireSafeTunnelBearerCredential,
  type LoadedSafeTunnelState,
  type SafeTunnelMachineCredentials,
  type SafeTunnelPersistedState,
  type SafeTunnelStateStorage,
} from "./safeTunnelState.js";

export type SafeTunnelServiceErrorCode =
  | "authorization_expired"
  | "credentials_rejected"
  | "invalid_heartbeat"
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

export interface SafeTunnelEnableInput {
  readonly frpcPath?: string;
  readonly localPiWebUrl?: string;
}

export interface SafeTunnelEnableOptions {
  /** Browser-bound classification accumulated before runtime credentials arrive. */
  readonly credentialBoundary?: SafeTunnelCredentialBoundary;
}

export type SafeTunnelPublicDeviceAuthorization = Omit<
  SafeTunnelDeviceAuthorization,
  "deviceCode"
>;

export interface SafeTunnelLoginObserver {
  readonly onAuthorizationApproved?: () => void;
  /** Called before public approval metadata so observers can scrub re-entrant views. */
  readonly onCredentialRedactionValues?: (values: readonly string[]) => void;
  readonly onDeviceAuthorization?: (
    authorization: SafeTunnelPublicDeviceAuthorization,
  ) => void;
  readonly onMachineRegistered?: () => void;
}

export interface SafeTunnelLoginOptions {
  /** Browser-bound classification accumulated before login learns later credentials. */
  readonly credentialBoundary?: SafeTunnelCredentialBoundary;
  readonly signal?: AbortSignal;
}

export interface SafeTunnelLoginResult {
  /** Ephemeral values used only to scrub browser-bound operation snapshots. */
  readonly credentialRedactionValues: readonly string[];
  readonly machineCredentials: SafeTunnelMachineCredentials;
  readonly registeredMachine: SafeTunnelRegisteredMachine;
}

export interface SafeTunnelPreparedTunnelConfig extends SafeTunnelMachineTunnelConfig {
  /** Private frpc authentication values carried only for downstream scrubbing. */
  readonly credentialRedactionValues: readonly string[];
  readonly localPiWebUrl: string;
  readonly frpcConfigToml: string;
}

export interface SafeTunnelServiceDependencies {
  readonly controlPlane: SafeTunnelControlPlane;
  readonly stateStorage: SafeTunnelStateStorage;
  readonly frpcTrustedCaPath?: string;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * PI WEB-owned Safe Tunnel application boundary. It coordinates durable local
 * intent/credentials with the normalized Control API contract, but owns no
 * binary acquisition or child process behavior.
 */
export class SafeTunnelService {
  private readonly frpcTrustedCaPath: string;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private activeCredentialBoundary: {
    readonly boundary: SafeTunnelCredentialBoundary;
    readonly machineId: string;
    readonly machineToken: string;
  } | undefined;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: SafeTunnelServiceDependencies) {
    this.frpcTrustedCaPath = dependencies.frpcTrustedCaPath
      ?? safeTunnelFrpcTrustedCaPath(dependencies.stateStorage.filePath);
    this.now = dependencies.now ?? (() => new Date());
    this.sleep = dependencies.sleep ?? abortableSleep;
  }

  get statePath(): string {
    return this.dependencies.stateStorage.filePath;
  }

  async state(): Promise<LoadedSafeTunnelState> {
    await this.mutationTail;
    return this.dependencies.stateStorage.load();
  }

  /** Durably merges a validated browser/public credential boundary. */
  persistCredentialBoundary(
    boundary: SafeTunnelCredentialBoundary,
  ): Promise<void> {
    return this.persistCredentialBoundaryWithCode(
      boundary,
      "invalid_tunnel_config",
    );
  }

  async login(
    input: SafeTunnelLoginInput,
    observer: SafeTunnelLoginObserver = {},
    options: SafeTunnelLoginOptions = {},
  ): Promise<SafeTunnelLoginResult> {
    throwIfAborted(options.signal);
    const existing = await this.state();
    const login = normalizeLoginInput(input, existing.state);
    const persistedCredentialBoundary = this.credentialBoundaryForState(
      existing,
      "invalid_login",
    );
    const credentialBoundary = options.credentialBoundary
      ?? persistedCredentialBoundary;
    if (options.credentialBoundary !== undefined) {
      requireCredentialClassification(
        credentialBoundary,
        persistedCredentialBoundary.classification(),
        "invalid_login",
      );
    }
    requireCredentialClassification(credentialBoundary, {
      publicValues: loginPublicValues(this.statePath, login),
    }, "invalid_login");
    await this.persistCredentialBoundaryWithCode(
      credentialBoundary,
      "invalid_login",
    );

    const started = classifyDeviceAuthorization(
      await this.dependencies.controlPlane.startDeviceAuthorization({
        controlApiBaseUrl: login.controlApiBaseUrl,
        clientVersion: safeTunnelClientVersion,
      }, options.signal === undefined ? {} : { signal: options.signal }),
    );
    requireCredentialClassification(credentialBoundary, {
      credentialValues: [started.deviceCode],
      publicValues: deviceAuthorizationPublicValues(started),
    }, "invalid_login");
    await this.persistCredentialBoundaryWithCode(
      credentialBoundary,
      "invalid_login",
    );
    throwIfAborted(options.signal);
    observer.onCredentialRedactionValues?.([started.deviceCode]);
    observer.onDeviceAuthorization?.({
      userCode: started.userCode,
      verificationUri: started.verificationUri,
      verificationUriComplete: started.verificationUriComplete,
      expiresAt: started.expiresAt,
      intervalSeconds: started.intervalSeconds,
    });

    const authorization = await this.waitForApproval(
      login.controlApiBaseUrl,
      started,
      options.signal,
    );
    throwIfAborted(options.signal);
    const connectorAccessToken = requireSafeTunnelBearerCredential(
      authorization.accessToken,
      "accessToken",
    );
    requireCredentialClassification(credentialBoundary, {
      credentialValues: [connectorAccessToken],
      publicValues: approvedAuthorizationPublicValues(authorization),
    }, "invalid_login");
    await this.persistCredentialBoundaryWithCode(
      credentialBoundary,
      "invalid_login",
    );
    observer.onAuthorizationApproved?.();

    // Once registration begins, let its one-time credential response finish and
    // persist even if the user disables concurrently; the bridge will observe
    // cancellation before it can arm supervision.
    const registeredMachine = normalizeRegisteredPublicIngress(
      await this.dependencies.controlPlane.registerMachine({
        controlApiBaseUrl: login.controlApiBaseUrl,
        connectorAccessToken,
        machineName: login.machineName,
        machineSlug: login.machineSlug,
        localPiWebUrl: login.localPiWebUrl,
        clientVersion: safeTunnelClientVersion,
      }),
    );
    if (registeredMachine.machine.slug !== login.machineSlug) {
      throw new SafeTunnelServiceError("invalid_login");
    }
    const machineToken = requireSafeTunnelBearerCredential(
      registeredMachine.machineToken,
      "machineToken",
    );
    requireCredentialClassification(credentialBoundary, {
      credentialValues: [machineToken],
      publicValues: registeredMachinePublicValues(registeredMachine),
    }, "invalid_login");

    const machineCredentials: SafeTunnelMachineCredentials = {
      controlApiBaseUrl: login.controlApiBaseUrl,
      credentialStatus: "active",
      machineId: registeredMachine.machine.id,
      machineToken,
      machineSlug: registeredMachine.machine.slug,
      publicUrl: registeredMachine.publicUrl,
    };

    await this.mutateState((current) => ({
      ...current,
      localPiWebUrl: login.localPiWebUrl,
      ...persistedCredentialBoundaryState(credentialBoundary),
      machine: machineCredentials,
      ...(login.frpcPath === undefined ? {} : { frpcPath: login.frpcPath }),
    }));
    this.rememberCredentialBoundary(machineCredentials, credentialBoundary);
    observer.onMachineRegistered?.();

    return {
      credentialRedactionValues: [
        started.deviceCode,
        connectorAccessToken,
        machineToken,
      ],
      machineCredentials,
      registeredMachine,
    };
  }

  async enable(
    input: SafeTunnelEnableInput = {},
    options: SafeTunnelEnableOptions = {},
  ): Promise<SafeTunnelPersistedState> {
    const normalizedFrpcPath = input.frpcPath === undefined
      ? undefined
      : requireNonEmptyString(input.frpcPath);
    let normalizedLocalPiWebUrl: string | undefined;
    try {
      normalizedLocalPiWebUrl = input.localPiWebUrl === undefined
        ? undefined
        : normalizeSafeTunnelLocalPiWebUrl(input.localPiWebUrl);
    } catch {
      throw new SafeTunnelServiceError("invalid_login");
    }

    let credentialBoundary: SafeTunnelCredentialBoundary | undefined;
    const enabled = await this.mutateState((current) => {
      const machine = current.machine;
      if (machine === undefined) throw new SafeTunnelServiceError("not_registered");
      if (machine.credentialStatus === "rejected") {
        throw new SafeTunnelServiceError("credentials_rejected");
      }
      const persistedCredentialBoundary = this.credentialBoundaryForState({
        exists: true,
        state: current,
      }, "invalid_tunnel_config");
      credentialBoundary = options.credentialBoundary
        ?? persistedCredentialBoundary;
      if (options.credentialBoundary !== undefined) {
        requireCredentialClassification(
          credentialBoundary,
          persistedCredentialBoundary.classification(),
          "invalid_tunnel_config",
        );
      }
      const next = {
        ...current,
        desiredState: "enabled" as const,
        ...persistedCredentialBoundaryState(credentialBoundary),
        ...(normalizedLocalPiWebUrl === undefined ? {} : { localPiWebUrl: normalizedLocalPiWebUrl }),
        ...(normalizedFrpcPath === undefined ? {} : { frpcPath: normalizedFrpcPath }),
      };
      requireCredentialClassification(credentialBoundary, {
        publicValues: persistedStatePublicValues(this.statePath, next),
      }, "invalid_tunnel_config");
      return {
        ...next,
        ...persistedCredentialBoundaryState(credentialBoundary),
      };
    });
    if (credentialBoundary !== undefined && enabled.machine !== undefined) {
      this.rememberCredentialBoundary(enabled.machine, credentialBoundary);
    }
    return enabled;
  }

  disable(): Promise<SafeTunnelPersistedState> {
    return this.mutateState((current) => ({ ...current, desiredState: "disabled" }));
  }

  async getTunnelConfig(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<SafeTunnelPreparedTunnelConfig> {
    const loaded = await this.state();
    const credentials = loaded.state.machine;
    if (credentials === undefined) throw new SafeTunnelServiceError("not_registered");
    if (credentials.credentialStatus === "rejected") {
      throw new SafeTunnelServiceError("credentials_rejected");
    }
    const credentialBoundary = this.credentialBoundaryForState(
      loaded,
      "invalid_tunnel_config",
    );

    let tunnelConfig: SafeTunnelMachineTunnelConfig;
    try {
      tunnelConfig = await this.dependencies.controlPlane.getMachineTunnelConfig(
        credentials,
        options,
      );
    } catch (error: unknown) {
      await this.rememberRejectedCredentials(credentials, error).catch(() => undefined);
      throw error;
    }
    if (tunnelConfig.machineId !== credentials.machineId
      || !matchesRegisteredPublicIngress(tunnelConfig, credentials.publicUrl)) {
      throw new SafeTunnelServiceError("invalid_tunnel_config");
    }
    const prepared = applySafeTunnelLocalTarget(
      tunnelConfig,
      loaded.state.localPiWebUrl,
      this.frpcTrustedCaPath,
    );
    const frpcSecurity = inspectSafeTunnelFrpcConfigSecurity(
      prepared.frpcConfigToml,
      { trustedCaFile: this.frpcTrustedCaPath },
    );
    requireCredentialClassification(credentialBoundary, {
      credentialValues: frpcSecurity.credentialValues,
      publicValues: tunnelConfigPublicValues(
        prepared,
        credentials,
        frpcSecurity.nonSecretValues,
      ),
    }, "invalid_tunnel_config");
    await this.persistCredentialBoundaryWithCode(
      credentialBoundary,
      "invalid_tunnel_config",
    );
    this.rememberCredentialBoundary(credentials, credentialBoundary);
    return prepared;
  }

  async recordHeartbeat(
    input: {
      readonly tunnelStatus: SafeTunnelHeartbeatTunnelStatus;
      readonly errorMessage?: string;
    },
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<SafeTunnelMachineHeartbeat> {
    const loaded = await this.state();
    const credentials = loaded.state.machine;
    if (credentials === undefined) throw new SafeTunnelServiceError("not_registered");
    if (credentials.credentialStatus === "rejected") {
      throw new SafeTunnelServiceError("credentials_rejected");
    }
    const credentialBoundary = this.credentialBoundaryForState(
      loaded,
      "invalid_heartbeat",
    );

    let heartbeat: SafeTunnelMachineHeartbeat;
    try {
      heartbeat = await this.dependencies.controlPlane.recordMachineHeartbeat(
        credentials,
        {
          clientVersion: safeTunnelClientVersion,
          tunnelStatus: input.tunnelStatus,
          ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
        },
        options,
      );
    } catch (error: unknown) {
      // Preserve the terminal authentication category even if recording the
      // durable diagnostic itself fails; the runtime must still stop safely.
      await this.rememberRejectedCredentials(credentials, error).catch(() => undefined);
      throw error;
    }
    if (heartbeat.machineId !== credentials.machineId) {
      throw new SafeTunnelServiceError("invalid_heartbeat");
    }
    requireCredentialClassification(credentialBoundary, {
      publicValues: heartbeatPublicValues(heartbeat),
    }, "invalid_heartbeat");
    await this.persistCredentialBoundaryWithCode(
      credentialBoundary,
      "invalid_heartbeat",
    );
    this.rememberCredentialBoundary(credentials, credentialBoundary);
    return heartbeat;
  }

  private async waitForApproval(
    controlApiBaseUrl: string,
    started: SafeTunnelDeviceAuthorization,
    signal?: AbortSignal,
  ) {
    const expiresAtMilliseconds = Date.parse(started.expiresAt);

    for (;;) {
      throwIfAborted(signal);
      if (expiresAtMilliseconds <= this.now().getTime()) {
        throw new SafeTunnelServiceError("authorization_expired");
      }

      const completion = await this.dependencies.controlPlane.completeDeviceAuthorization({
        controlApiBaseUrl,
        deviceCode: started.deviceCode,
      }, signal === undefined ? {} : { signal });
      throwIfAborted(signal);
      if (completion.kind === "approved") return completion.authorization;

      const remainingMilliseconds = expiresAtMilliseconds - this.now().getTime();
      if (remainingMilliseconds <= 0) {
        throw new SafeTunnelServiceError("authorization_expired");
      }
      await this.sleep(
        Math.min(started.intervalSeconds * 1000, remainingMilliseconds),
        signal,
      );
    }
  }

  private async persistCredentialBoundaryWithCode(
    boundary: SafeTunnelCredentialBoundary,
    failureCode: SafeTunnelServiceErrorCode,
  ): Promise<void> {
    await this.mutateState((current) => {
      const persistedBoundary = this.credentialBoundaryForState({
        exists: true,
        state: current,
      }, failureCode);
      requireCredentialClassification(
        boundary,
        persistedBoundary.classification(),
        failureCode,
      );
      const persisted = persistedCredentialBoundaryState(boundary);
      if (sameValues(
        current.credentialBoundaryPrivateValues,
        persisted.credentialBoundaryPrivateValues,
      ) && sameValues(
        current.credentialBoundaryPublicValues,
        persisted.credentialBoundaryPublicValues,
      )) return current;
      return { ...current, ...persisted };
    });
  }

  private async rememberRejectedCredentials(
    credentials: SafeTunnelMachineCredentials,
    error: unknown,
  ): Promise<void> {
    if (!(error instanceof SafeTunnelControlPlaneError)
      || error.code !== "authentication_failed") return;

    await this.mutateState((current) => {
      const currentMachine = current.machine;
      if (currentMachine?.machineId !== credentials.machineId
        || currentMachine.machineToken !== credentials.machineToken
        || currentMachine.credentialStatus === "rejected") return current;
      return {
        ...current,
        machine: { ...currentMachine, credentialStatus: "rejected" },
      };
    });
  }

  private credentialBoundaryForState(
    loaded: LoadedSafeTunnelState,
    failureCode: SafeTunnelServiceErrorCode,
  ): SafeTunnelCredentialBoundary {
    const machine = loaded.state.machine;
    const active = this.activeCredentialBoundary;
    const boundary = machine !== undefined
      && active?.machineId === machine.machineId
      && active.machineToken === machine.machineToken
      ? active.boundary.clone()
      : new SafeTunnelCredentialBoundary();
    requireCredentialClassification(boundary, {
      credentialValues: [
        ...(loaded.state.credentialBoundaryPrivateValues ?? []),
        ...(machine === undefined ? [] : [machine.machineToken]),
      ],
      publicValues: persistedStatePublicValues(this.statePath, loaded.state),
    }, failureCode);
    return boundary;
  }

  private rememberCredentialBoundary(
    credentials: SafeTunnelMachineCredentials,
    boundary: SafeTunnelCredentialBoundary,
  ): void {
    this.activeCredentialBoundary = {
      boundary,
      machineId: credentials.machineId,
      machineToken: credentials.machineToken,
    };
  }

  private mutateState(
    update: (current: SafeTunnelPersistedState) => SafeTunnelPersistedState,
  ): Promise<SafeTunnelPersistedState> {
    const mutation = this.mutationTail.then(async () => {
      const loaded = await this.dependencies.stateStorage.load();
      const next = update(loaded.state);
      if (next !== loaded.state) await this.dependencies.stateStorage.save(next);
      return next;
    });
    this.mutationTail = mutation.then(() => undefined, () => undefined);
    return mutation;
  }
}

function normalizeRegisteredPublicIngress(
  registeredMachine: SafeTunnelRegisteredMachine,
): SafeTunnelRegisteredMachine {
  let publicUrl: string;
  try {
    publicUrl = normalizeSafeTunnelPublicUrl(registeredMachine.publicUrl);
  } catch {
    throw new SafeTunnelServiceError("invalid_login");
  }
  if (new URL(publicUrl).hostname !== registeredMachine.publicHostname) {
    throw new SafeTunnelServiceError("invalid_login");
  }
  return { ...registeredMachine, publicUrl };
}

function matchesRegisteredPublicIngress(
  tunnelConfig: SafeTunnelMachineTunnelConfig,
  registeredPublicUrl: string | undefined,
): boolean {
  if (registeredPublicUrl === undefined) return false;
  try {
    const registeredOrigin = normalizeSafeTunnelPublicUrl(registeredPublicUrl);
    const configuredOrigin = normalizeSafeTunnelPublicUrl(tunnelConfig.publicUrl);
    return configuredOrigin === registeredOrigin
      && tunnelConfig.publicHostname === new URL(registeredOrigin).hostname;
  } catch {
    return false;
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
  if (machineName.length > 80) throw new SafeTunnelServiceError("invalid_login");
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
  frpcTrustedCaPath: string,
): SafeTunnelPreparedTunnelConfig {
  let normalizedLocalPiWebUrl: string;
  try {
    normalizedLocalPiWebUrl = normalizeSafeTunnelLocalPiWebUrl(localPiWebUrl);
    const trust = { trustedCaFile: frpcTrustedCaPath };
    const frpcConfigToml = prepareSafeTunnelFrpcConfig(
      tunnelConfig,
      normalizedLocalPiWebUrl,
      trust,
    );
    const frpcSecurity = inspectSafeTunnelFrpcConfigSecurity(frpcConfigToml, trust);
    const prepared = {
      ...tunnelConfig,
      credentialRedactionValues: frpcSecurity.credentialValues,
      localPiWebUrl: normalizedLocalPiWebUrl,
      frpcConfigToml,
    };
    const credentialBoundary = new SafeTunnelCredentialBoundary();
    requireCredentialClassification(credentialBoundary, {
      credentialValues: frpcSecurity.credentialValues,
      publicValues: tunnelConfigPublicValues(
        prepared,
        undefined,
        frpcSecurity.nonSecretValues,
      ),
    }, "invalid_tunnel_config");
    return prepared;
  } catch {
    throw new SafeTunnelServiceError("invalid_tunnel_config");
  }
}

function classifyDeviceAuthorization(
  authorization: SafeTunnelDeviceAuthorization,
): SafeTunnelDeviceAuthorization {
  const deviceCode = authorization.deviceCode;
  if (deviceCode === ""
    || deviceCode.length > 4_096
    || hasTerminalControl(deviceCode)) {
    throw new SafeTunnelServiceError("invalid_login");
  }
  return { ...authorization, deviceCode };
}

function requireCredentialClassification(
  boundary: SafeTunnelCredentialBoundary,
  classification: SafeTunnelCredentialClassification,
  failureCode: SafeTunnelServiceErrorCode,
): void {
  if (!boundary.classify(classification)) {
    throw new SafeTunnelServiceError(failureCode);
  }
}

function loginPublicValues(
  statePath: string,
  login: NormalizedSafeTunnelLoginInput,
): readonly string[] {
  return withContiguousPublicComposite([
    statePath,
    login.controlApiBaseUrl,
    login.localPiWebUrl,
    login.machineName,
    login.machineSlug,
    ...(login.frpcPath === undefined ? [] : [login.frpcPath]),
  ]);
}

function deviceAuthorizationPublicValues(
  authorization: SafeTunnelDeviceAuthorization,
): readonly string[] {
  return withContiguousPublicComposite([
    authorization.userCode,
    authorization.verificationUri,
    authorization.verificationUriComplete,
    authorization.expiresAt,
    authorization.intervalSeconds.toString(),
  ]);
}

function approvedAuthorizationPublicValues(
  authorization: SafeTunnelApprovedDeviceAuthorization,
): readonly string[] {
  return withContiguousPublicComposite([
    authorization.expiresAt,
    authorization.account.id,
    authorization.account.publicNamespace,
  ]);
}

function registeredMachinePublicValues(
  registeredMachine: SafeTunnelRegisteredMachine,
): readonly string[] {
  return withContiguousPublicComposite([
    registeredMachine.machine.id,
    registeredMachine.machine.accountId,
    registeredMachine.machine.name,
    registeredMachine.machine.slug,
    registeredMachine.publicHostname,
    registeredMachine.publicUrl,
  ]);
}

function persistedStatePublicValues(
  statePath: string,
  state: SafeTunnelPersistedState,
): readonly string[] {
  const machine = state.machine;
  const machineHostname = machine?.publicUrl === undefined
    ? undefined
    : new URL(machine.publicUrl).hostname;
  const currentValues = [
    statePath,
    state.desiredState,
    state.localPiWebUrl,
    ...(state.frpcPath === undefined ? [] : [state.frpcPath]),
    ...(machine === undefined
      ? []
      : [
          machine.controlApiBaseUrl,
          machine.machineId,
          ...(machine.machineSlug === undefined ? [] : [machine.machineSlug]),
          ...(machine.credentialBoundaryPublicValues ?? []),
          ...(machine.publicUrl === undefined ? [] : [machine.publicUrl]),
          ...(machineHostname === undefined ? [] : [machineHostname]),
        ]),
  ];
  return [
    ...(state.credentialBoundaryPublicValues ?? []),
    ...withContiguousPublicComposite(currentValues),
    ...(machine === undefined
      ? []
      : withContiguousPublicComposite([
          machine.machineId,
          ...(machine.machineSlug === undefined ? [] : [machine.machineSlug]),
          ...(machineHostname === undefined
            ? []
            : [machineHostname.split(".")[0] ?? ""]),
        ])),
  ];
}

function tunnelConfigPublicValues(
  tunnelConfig: SafeTunnelPreparedTunnelConfig,
  machineCredentials: SafeTunnelMachineCredentials | undefined,
  generatedNonSecretValues: readonly string[],
): readonly string[] {
  return withContiguousPublicComposite([
    tunnelConfig.machineId,
    tunnelConfig.publicHostname,
    tunnelConfig.publicUrl,
    tunnelConfig.localPiWebUrl,
    tunnelConfig.proxyName,
    ...generatedNonSecretValues,
    ...(machineCredentials === undefined
      ? []
      : [
          machineCredentials.controlApiBaseUrl,
          machineCredentials.machineId,
          ...(machineCredentials.machineSlug === undefined
            ? []
            : [machineCredentials.machineSlug]),
          ...(machineCredentials.publicUrl === undefined
            ? []
            : [machineCredentials.publicUrl]),
        ]),
  ]);
}

function persistedCredentialBoundaryState(
  boundary: SafeTunnelCredentialBoundary,
): {
  readonly credentialBoundaryPrivateValues: readonly string[];
  readonly credentialBoundaryPublicValues: readonly string[];
} {
  const classification = boundary.classification();
  return {
    credentialBoundaryPrivateValues: classification.credentialValues,
    credentialBoundaryPublicValues: classification.publicValues,
  };
}

function sameValues(
  left: readonly string[] | undefined,
  right: readonly string[],
): boolean {
  const normalizedLeft = left ?? [];
  return normalizedLeft.length === right.length
    && normalizedLeft.every((value, index) => value === right[index]);
}

function heartbeatPublicValues(
  heartbeat: SafeTunnelMachineHeartbeat,
): readonly string[] {
  return withContiguousPublicComposite([
    heartbeat.machineId,
    heartbeat.lastSeenAt,
    heartbeat.nextHeartbeatSeconds.toString(),
  ]);
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

function requireNonEmptyString(value: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new SafeTunnelServiceError("invalid_login");
  return normalized;
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Safe Tunnel enablement was cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new Error("Safe Tunnel enablement was cancelled.");
}

function safeTunnelServiceErrorMessage(code: SafeTunnelServiceErrorCode): string {
  switch (code) {
    case "authorization_expired":
      return "Safe Tunnel device authorization expired before approval.";
    case "credentials_rejected":
      return "Safe Tunnel machine credentials were rejected or revoked.";
    case "invalid_heartbeat":
      return "The Safe Tunnel service returned a heartbeat for an unexpected machine.";
    case "invalid_login":
      return "Safe Tunnel login settings are invalid.";
    case "invalid_tunnel_config":
      return "The Safe Tunnel service returned configuration for an unexpected local target.";
    case "not_registered":
      return "Register or log in to PI WEB Safe Tunnels first.";
  }
}
