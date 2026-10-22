// Self-update routes with an injected service, so the guards (apply failure,
// apply start) are tested without running a real update command.
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import * as childProcess from "node:child_process";

// The route module destructures spawn, so a namespace spy would not intercept
// it; the module needs a full mock for the command-mode apply test.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const fakeChild = {
    unref: () => undefined,
    once: (event: string, callback: () => void) => { if (event === "spawn") callback(); },
  };
  return { ...actual, spawn: vi.fn(() => fakeChild) };
});
// Every host this suite runs on reads as booted under systemd, so a pinned Linux platform means the
// same thing on a Mac, on Windows and in a sandbox without /run/systemd.
vi.mock("./detachedCommand.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./detachedCommand.js")>();
  const { nativeServiceBackendKind } = await import("../../../nativeServices/serviceBackendKind.js");
  return { ...actual, currentNativeServiceBackendKind: () => nativeServiceBackendKind(process.platform, process.env, () => true) };
});
import { createSelfUpdateService, registerSelfUpdateRoutes, type SelfUpdateService } from "./selfUpdateRoutes.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function fakeService(onApply: () => void | Promise<void>): SelfUpdateService {
  return { apply: () => Promise.resolve(onApply()) };
}

describe("self-update routes", () => {
  it("refuses to apply when the host has no update command", async () => {
    app = Fastify({ logger: false });
    registerSelfUpdateRoutes(app, {
      selfUpdate: fakeService(() => { throw new Error("no update command configured"); }),
    });
    await app.ready();
    const response = await app.inject({ method: "POST", url: "/api/pi-web/update/apply", payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ started: false, error: "no update command configured" });
  });

  it("acknowledges an apply that started detached", async () => {
    let applied = 0;
    app = Fastify({ logger: false });
    registerSelfUpdateRoutes(app, {
      selfUpdate: fakeService(() => { applied += 1; }),
    });
    await app.ready();
    const response = await app.inject({ method: "POST", url: "/api/pi-web/update/apply", payload: {} });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ started: true });
    expect(applied).toBe(1);
  });
});
// Command mode: apply hands the configured command to systemd-run, or to a
// detached bash child on macOS.

describe("self-update command mode", () => {
  const inheritedSupervisor = process.env["PI_WEB_SUPERVISOR"];

  beforeEach(() => {
    delete process.env["PI_WEB_SUPERVISOR"];
  });

  afterEach(() => {
    delete process.env["PI_WEB_UPDATE_COMMAND"];
    if (inheritedSupervisor !== undefined) process.env["PI_WEB_SUPERVISOR"] = inheritedSupervisor;
    restorePlatform();
  });

  const realPlatform = process.platform;

  /** Pin `process.platform` for one test; `restorePlatform` puts it back. */
  function withPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
  }

  function restorePlatform(): void {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  }

  it("refuses to apply without a configured command", async () => {
    vi.stubEnv("PI_WEB_CONFIG", join(process.env["PI_WEB_DATA_DIR"] ?? "", "missing-config.json"));
    vi.stubEnv("PI_WEB_UPDATE_COMMAND", "");
    try {
      const service = createSelfUpdateService(undefined);
      await expect(service.apply()).rejects.toThrow(/no update command configured/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("hands the configured command to systemd-run, detached", async () => {
    // Pinned to Linux: the detach strategy is platform-dependent, and this
    // suite must assert the same thing on a maintainer's Mac as in CI.
    withPlatform("linux");
    process.env["PI_WEB_UPDATE_COMMAND"] = "/nix/store/xxx/bin/pi-web-autoupdate --force";
    const spawnMock = vi.mocked(childProcess.spawn);
    spawnMock.mockClear();
    const service = createSelfUpdateService(undefined, () => Promise.resolve({ state: "confirmed" }));
    await service.apply();
    expect(spawnMock).toHaveBeenCalledOnce();
    const [binary, args] = spawnMock.mock.calls[0] ?? [];
    expect(binary).toBe("systemd-run");
    // The env command reaches bash -lc verbatim; the unit name keeps the
    // apply identifiable in systemd's journal.
    expect(args).toEqual(expect.arrayContaining(["--unit=pi-web-self-update", "/bin/bash", "-lc"]));
    expect(args?.at(-1)).toBe("/nix/store/xxx/bin/pi-web-autoupdate --force");

    const inheritedFromOtherServices = createSelfUpdateService(undefined, () => Promise.resolve({ state: "other-installation" }));
    await expect(inheritedFromOtherServices.apply()).rejects.toThrow(/PI_WEB_UPDATE_COMMAND/);
    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it("falls back to a detached bash child on macOS, which has no systemd-run", async () => {
    withPlatform("darwin");
    process.env["PI_WEB_UPDATE_COMMAND"] = "/opt/homebrew/bin/pi-web-autoupdate --force";
    const spawnMock = vi.mocked(childProcess.spawn);
    spawnMock.mockClear();
    const service = createSelfUpdateService(undefined, () => Promise.resolve({ state: "confirmed" }));
    await service.apply();
    expect(spawnMock).toHaveBeenCalledOnce();
    const [binary, args] = spawnMock.mock.calls[0] ?? [];
    expect(binary).toBe("/bin/bash");
    expect(args).toEqual(["-lc", "/opt/homebrew/bin/pi-web-autoupdate --force"]);
  });
});
