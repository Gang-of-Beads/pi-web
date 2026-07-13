import { describe, expect, it, vi } from "vitest";
import type { Machine, PiWebReleaseStatus, PiWebStatusResponse } from "../api";
import { initialAppState, type AppState } from "../appState";
import { PiWebStatusController, type PiWebStatusControllerDependencies } from "./piWebStatusController";

type StatusApi = NonNullable<PiWebStatusControllerDependencies["api"]>;

describe("PiWebStatusController", () => {
  it("targets the selected machine and applies refreshed status", async () => {
    const harness = createHarness("remote-a");
    harness.piWebStatus.mockResolvedValue(status("remote"));

    await harness.controller.refresh();

    expect(harness.piWebStatus).toHaveBeenCalledWith("remote-a");
    expect(harness.state().piWebStatus?.generatedAt).toBe("remote");
  });

  it("does not let an older periodic response overwrite a forced response", async () => {
    const harness = createHarness();
    const regular = createDeferred<PiWebStatusResponse>();
    const forced = createDeferred<PiWebStatusResponse>();
    harness.piWebStatus.mockReturnValue(regular.promise);
    harness.checkForUpdates.mockReturnValue(forced.promise);

    const regularRequest = harness.controller.refresh();
    const forcedRequest = harness.controller.checkForUpdates();
    forced.resolve(status("forced"));
    await forcedRequest;
    regular.resolve(status("regular"));
    await regularRequest;

    expect(harness.state().piWebStatus?.generatedAt).toBe("forced");
  });

  it("deduplicates forced checks and suppresses periodic refresh while one is pending", async () => {
    const harness = createHarness();
    const forced = createDeferred<PiWebStatusResponse>();
    harness.checkForUpdates.mockReturnValue(forced.promise);

    const first = harness.controller.checkForUpdates();
    const second = harness.controller.checkForUpdates();
    await harness.controller.refresh();

    expect(second).toBe(first);
    expect(harness.checkForUpdates).toHaveBeenCalledOnce();
    expect(harness.piWebStatus).not.toHaveBeenCalled();

    forced.resolve(status("forced"));
    await first;
  });

  it("does not apply a response or error after the selected machine changes", async () => {
    const harness = createHarness("remote-a");
    const forced = createDeferred<PiWebStatusResponse>();
    harness.checkForUpdates.mockReturnValue(forced.promise);

    const request = harness.controller.checkForUpdates();
    harness.selectMachine("remote-b");
    forced.resolve(status("remote-a", { error: "registry unavailable" }));
    await expect(request).resolves.toBeUndefined();

    expect(harness.state().piWebStatus).toBeUndefined();
  });

  it.each([
    [{ error: "registry unavailable" }, "PI WEB update check failed: registry unavailable"],
    [{ skipped: true }, "PI WEB update check was skipped"],
  ] as const)("applies status and rejects an unsuccessful manual check", async (release, message) => {
    const harness = createHarness();
    harness.checkForUpdates.mockResolvedValue(status("checked", release));

    await expect(harness.controller.checkForUpdates()).rejects.toThrow(message);

    expect(harness.state().piWebStatus?.generatedAt).toBe("checked");
  });

  it("clears current status and reports periodic refresh failures", async () => {
    const harness = createHarness();
    const error = new Error("offline");
    harness.setStatus(status("old"));
    harness.piWebStatus.mockRejectedValue(error);

    await harness.controller.refresh();

    expect(harness.state().piWebStatus).toBeUndefined();
    expect(harness.onRefreshError).toHaveBeenCalledWith("local", error);
  });
});

function createHarness(machineId = "local") {
  let state: AppState = { ...initialAppState(), selectedMachine: machine(machineId) };
  const piWebStatus = vi.fn<StatusApi["piWebStatus"]>();
  const checkForUpdates = vi.fn<StatusApi["checkForUpdates"]>();
  const onRefreshError = vi.fn<(machineId: string, error: unknown) => void>();
  const controller = new PiWebStatusController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    { api: { piWebStatus, checkForUpdates }, onRefreshError },
  );
  return {
    controller,
    piWebStatus,
    checkForUpdates,
    onRefreshError,
    state: () => state,
    setStatus: (piWebStatusValue: PiWebStatusResponse) => { state = { ...state, piWebStatus: piWebStatusValue }; },
    selectMachine: (id: string) => { state = { ...state, selectedMachine: machine(id) }; },
  };
}

function machine(id: string): Machine {
  return {
    id,
    name: id,
    kind: id === "local" ? "local" : "remote",
    ...(id === "local" ? {} : { baseUrl: `https://${id}.example.test` }),
    createdAt: "now",
    updatedAt: "now",
  };
}

function status(generatedAt: string, release: Partial<PiWebReleaseStatus> = {}): PiWebStatusResponse {
  return {
    packageName: "@jmfederico/pi-web",
    generatedAt,
    components: {
      web: { component: "web", label: "Web/UI", stale: false, available: true },
      sessiond: { component: "sessiond", label: "Session daemon", stale: false, available: true },
    },
    release: { packageName: "@jmfederico/pi-web", updateAvailable: false, ...release },
    commands: {},
    messages: [],
  };
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
