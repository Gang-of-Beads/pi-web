import { join } from "node:path";
import { ModelRuntime, type CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { AuthProvidersResponse, AuthType, OAuthFlowState } from "../../shared/apiTypes.js";
import { getLoginProviderOptions, getLogoutProviderOptions } from "./authProviderOptions.js";
import { OAuthLoginFlowService } from "./oauthLoginFlowService.js";

export interface AuthChange {
  removedProviderId?: string;
}

type AuthChangeListener = (change: AuthChange) => void | Promise<void>;

export interface AuthServiceDependencies {
  agentDir?: string;
  runtime?: ModelRuntime;
  authFlows?: OAuthLoginFlowService;
  logger?: AuthServiceLogger;
}

/** Minimal structured-logging seam for non-fatal auth propagation failures. */
export interface AuthServiceLogger {
  error(details: Record<string, unknown>, message: string): void;
}

interface AuthChangeContext {
  operation: "login" | "logout";
  providerId: string;
  authType?: AuthType;
}

const noopLogger: AuthServiceLogger = { error() { /* no-op */ } };

/**
 * Serializes the `PI_OFFLINE` windows below, which is what keeps their
 * save/restore pairs properly nested. Two overlapping calls would otherwise both
 * capture the forced `"1"` and restore it, leaving the whole process offline
 * permanently. Owned by this module only; nothing else may mutate it.
 */
let offlineRuntimeCreations: Promise<unknown> = Promise.resolve();

/**
 * Create the shared model runtime with runtime-owned network refreshes disabled.
 *
 * Upstream `ModelRuntime.refresh()`, `login()`, and `logout()` always refresh
 * with `allowNetwork: modelNetworkEnabled` by default, and `login()`/`logout()`
 * accept no abort signal. With the default (`PI_OFFLINE` unset) a single stalled
 * provider-catalog fetch can block those call paths for minutes — and, because
 * pi-web shares one runtime and pi coalesces per-provider refreshes, session
 * creation joins the same stalled fetch. Forcing `PI_OFFLINE` during construction makes every runtime-driven
 * refresh local-only; pi-web performs its own bounded catalog refreshes in the
 * background instead (see modelCatalogRefresher.ts).
 *
 * `modelNetworkEnabled` is computed once from the environment inside
 * `ModelRuntime.create()`, so the env var is the only lever upstream exposes.
 * Calls are queued so their env windows never overlap.
 */
function createOfflineModelRuntime(options: CreateModelRuntimeOptions): Promise<ModelRuntime> {
  const created = offlineRuntimeCreations.then(() => forceOfflineWhile(() => ModelRuntime.create(options)));
  // A failed creation must not poison the queue; the caller still sees the rejection.
  offlineRuntimeCreations = created.then(() => undefined, () => undefined);
  return created;
}

/**
 * Force `PI_OFFLINE` for the duration of `create`, then restore what was there.
 *
 * `process.env` is process-wide, so this window is a real global side effect:
 * anything reading `PI_OFFLINE` while `create` awaits observes offline mode,
 * including upstream's package manager, tools manager, and version check. That
 * is acceptable because pi-web only builds runtimes during daemon startup and in
 * tests, and the window is one `ModelRuntime.create()` call — but it is why
 * callers must stay serialized rather than run concurrently.
 */
async function forceOfflineWhile<T>(create: () => Promise<T>): Promise<T> {
  const previous = process.env["PI_OFFLINE"];
  process.env["PI_OFFLINE"] = "1";
  try {
    return await create();
  } finally {
    if (previous === undefined) delete process.env["PI_OFFLINE"];
    else process.env["PI_OFFLINE"] = previous;
  }
}

export function createModelRuntimeForAgentDir(agentDir: string): Promise<ModelRuntime> {
  return createOfflineModelRuntime({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  });
}

export class AuthService {
  readonly runtime: ModelRuntime;
  private readonly authFlows: OAuthLoginFlowService;
  private readonly logger: AuthServiceLogger;
  private readonly listeners = new Set<AuthChangeListener>();

  private constructor(runtime: ModelRuntime, authFlows: OAuthLoginFlowService, logger: AuthServiceLogger) {
    this.runtime = runtime;
    this.authFlows = authFlows;
    this.logger = logger;
  }

  static async create(deps: AuthServiceDependencies = {}): Promise<AuthService> {
    const runtime = deps.runtime ?? (deps.agentDir === undefined ? await createOfflineModelRuntime({}) : await createModelRuntimeForAgentDir(deps.agentDir));
    const logger = deps.logger ?? noopLogger;
    const authFlows = deps.authFlows ?? new OAuthLoginFlowService({ logger });
    return new AuthService(runtime, authFlows, logger);
  }

  subscribe(listener: AuthChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.authFlows.dispose();
    this.listeners.clear();
  }

  async authProviders(mode: "login" | "logout", authType?: AuthType): Promise<AuthProvidersResponse> {
    await this.runtime.refresh();
    const providers = mode === "logout" ? await getLogoutProviderOptions(this.runtime) : getLoginProviderOptions(this.runtime, authType);
    return { providers };
  }

  async saveApiKey(providerId: string, key: string): Promise<{ accepted: true }> {
    if (key.trim() === "") throw new Error("API key is required");
    const provider = await this.requireApiKeyLoginProvider(providerId);
    let promptAttempted = false;
    const interaction: AuthInteraction = {
      prompt: (prompt) => {
        if (promptAttempted) {
          throw new Error(`${provider.name} requires interactive setup; use Pi's generic /login flow`);
        }
        promptAttempted = true;
        if (prompt.signal?.aborted === true) throw new Error("Login cancelled");
        if (prompt.type !== "secret") {
          throw new Error(`${provider.name} requires interactive setup; use Pi's generic /login flow`);
        }
        return Promise.resolve(key);
      },
      notify: () => undefined,
    };
    await this.runtime.login(providerId, "api_key", interaction);
    await this.emit({}, { operation: "login", providerId, authType: "api_key" });
    return { accepted: true };
  }

  async logoutProvider(providerId: string): Promise<{ accepted: true }> {
    await this.runtime.logout(providerId);
    await this.emit({ removedProviderId: providerId }, { operation: "logout", providerId });
    return { accepted: true };
  }

  async startApiKeyLogin(providerId: string): Promise<OAuthFlowState> {
    const provider = await this.requireApiKeyLoginProvider(providerId);
    return this.authFlows.start({
      providerId,
      providerName: provider.name,
      runtime: this.runtime,
      authType: "api_key",
      onComplete: () => this.emit({}, { operation: "login", providerId, authType: "api_key" }),
    });
  }

  async startOAuthLogin(providerId: string): Promise<OAuthFlowState> {
    const provider = await this.requireOAuthLoginProvider(providerId);
    return this.authFlows.start({
      providerId,
      providerName: provider.name,
      runtime: this.runtime,
      authType: "oauth",
      onComplete: () => this.emit({}, { operation: "login", providerId, authType: "oauth" }),
    });
  }

  oauthFlow(flowId: string): OAuthFlowState {
    return this.authFlows.get(flowId);
  }

  respondToOAuthFlow(flowId: string, requestId: string, value: string): OAuthFlowState {
    return this.authFlows.respond(flowId, requestId, value);
  }

  cancelOAuthFlow(flowId: string): OAuthFlowState {
    return this.authFlows.cancel(flowId);
  }

  private async emit(change: AuthChange, context: AuthChangeContext): Promise<void> {
    const results = await Promise.allSettled([...this.listeners].map(async (listener) => listener(change)));
    for (const result of results) {
      if (result.status === "rejected") {
        this.logErrorNoThrow({ err: result.reason, ...context }, "auth-change listener failed");
      }
    }
  }

  private logErrorNoThrow(details: Record<string, unknown>, message: string): void {
    try {
      this.logger.error(details, message);
    } catch {
      // A diagnostic failure cannot turn an already-committed auth mutation into an API failure.
    }
  }

  private async requireApiKeyLoginProvider(providerId: string) {
    await this.runtime.refresh();
    const provider = getLoginProviderOptions(this.runtime, "api_key").find((option) => option.id === providerId);
    if (provider !== undefined) return provider;

    const knownProvider = this.runtime.getProviders().find((option) => option.id === providerId);
    if (knownProvider !== undefined) {
      throw new Error(`${knownProvider.name} does not support interactive API-key setup`);
    }
    throw new Error(`API key provider not found: ${providerId}`);
  }

  private async requireOAuthLoginProvider(providerId: string) {
    await this.runtime.refresh();
    const provider = getLoginProviderOptions(this.runtime, "oauth").find((option) => option.id === providerId);
    if (provider === undefined) throw new Error(`OAuth provider not found: ${providerId}`);
    return provider;
  }
}
