import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ScopedModel } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshScopedModelsFromSettings } from "./sessionModelScope.js";

/**
 * A provider's `refreshModels` changes the catalog under an open session. The
 * scope used to be resolved once at open time, so the session kept answering
 * with the stale list and marked every newly published model disabled (issue
 * #78); the request paths now re-resolve the saved patterns after a refresh.
 *
 * The runtime is stubbed, since what matters here is that the helper re-resolves
 * and only writes when the answer actually changed.
 */
interface ScopeResult {
  scopedModels: ScopedModel[];
  diagnostics: { type: string; message: string }[];
}

const mocks = vi.hoisted(() => ({ resolve: vi.fn<(patterns: string[], runtime: ModelRuntime) => Promise<ScopeResult>>() }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  resolveModelScopeWithDiagnostics: mocks.resolve,
}));

const catalog: { provider: string; id: string }[] = [];
let modelRuntime: ModelRuntime;

function scopedModels(keys: readonly string[]): ScopedModel[] {
  return keys.map((key) => {
    const [provider = "", id = ""] = key.split("/");
    return {
      model: {
        provider,
        id,
        name: id,
        api: "openai-completions",
        baseUrl: "http://example.invalid/v1",
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: false,
        contextWindow: 128_000,
        maxTokens: 4_096,
      },
    };
  });
}

function subject(patterns: string[] | undefined, liveScope: readonly string[]) {
  const setScopedModels = vi.fn<(models: ScopedModel[]) => void>();
  return {
    setScopedModels,
    input: {
      settingsManager: { getEnabledModels: () => patterns },
      modelRuntime,
      scopedModels: scopedModels(liveScope),
      setScopedModels,
    },
  };
}

beforeEach(async () => {
  catalog.length = 0;
  modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false });
  mocks.resolve.mockReset();
  mocks.resolve.mockImplementation((patterns) => Promise.resolve({
    scopedModels: scopedModels(catalog
      .filter((model) => patterns.includes(`${model.provider}/*`) || patterns.includes(`${model.provider}/${model.id}`))
      .map((model) => `${model.provider}/${model.id}`)),
    diagnostics: [],
  }));
});

describe("refreshScopedModelsFromSettings", () => {
  it("adopts a model the provider published and drops one it removed", async () => {
    catalog.push({ provider: "gateway", id: "model-a" }, { provider: "gateway", id: "model-c" });
    const { input, setScopedModels } = subject(["gateway/*"], ["gateway/model-a", "gateway/model-b"]);

    await refreshScopedModelsFromSettings(input);

    expect(setScopedModels).toHaveBeenCalledTimes(1);
    expect(setScopedModels.mock.calls[0]?.[0].map((entry) => entry.model.id)).toEqual(["model-a", "model-c"]);
  });

  it("leaves an already correct scope alone", async () => {
    catalog.push({ provider: "gateway", id: "model-a" });
    const { input, setScopedModels } = subject(["gateway/*"], ["gateway/model-a"]);

    await refreshScopedModelsFromSettings(input);

    expect(setScopedModels).not.toHaveBeenCalled();
  });

  it("keeps the empty scope of the everything-enabled state", async () => {
    catalog.push({ provider: "gateway", id: "model-a" });
    const { input, setScopedModels } = subject(undefined, []);

    await refreshScopedModelsFromSettings(input);

    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(setScopedModels).not.toHaveBeenCalled();
  });
});
