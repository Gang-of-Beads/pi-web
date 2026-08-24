// Self-update routes with an injected service, so the guards (disabled host,
// apply failure, apply start) are tested without touching real git.
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as childProcess from "node:child_process";

// The route module destructures spawn, so a namespace spy would not intercept
// it; the module needs a full mock for the command-mode apply test.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const fakeChild = {
    unref: () => undefined,
    once: (_event: string, callback: () => void) => { callback(); },
  };
  return { ...actual, spawn: vi.fn(() => fakeChild) };
});
import { packageVersion } from "../../piWebVersionReport.js";
import type { PiWebSelfUpdateStatus } from "../../shared/apiTypes.js";
import { createSelfUpdateService, registerSelfUpdateRoutes, type SelfUpdateService } from "./selfUpdateRoutes.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function fakeService(status: PiWebSelfUpdateStatus, onApply: () => void | Promise<void>): SelfUpdateService {
  return {
    status: () => Promise.resolve(status),
    apply: () => Promise.resolve(onApply()),
  };
}

const DISABLED_STATUS: PiWebSelfUpdateStatus = {
  enabled: false,
  current: "",
  latest: undefined,
  available: false,
  branch: undefined,
  checkedAt: "2026-08-18T00:00:00.000Z",
  disabledReason: "no checkout",
};

describe("self-update routes", () => {
  it("reports disabled hosts so the UI never offers updates", async () => {
    app = Fastify({ logger: false });
    registerSelfUpdateRoutes(app, { selfUpdate: fakeService(DISABLED_STATUS, () => undefined) });
    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/pi-web/update/status" });
    expect(response.json()).toEqual({ enabled: false, current: "", latest: undefined, available: false, branch: undefined, checkedAt: DISABLED_STATUS.checkedAt, disabledReason: "no checkout" });
  });

  it("refuses to apply when the host has no checkout", async () => {
    app = Fastify({ logger: false });
    registerSelfUpdateRoutes(app, {
      selfUpdate: fakeService(DISABLED_STATUS, () => { throw new Error("no checkout to update"); }),
    });
    await app.ready();
    const response = await app.inject({ method: "POST", url: "/api/pi-web/update/apply", payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ started: false, error: "no checkout to update" });
  });

  it("acknowledges an apply that started detached", async () => {
    let applied = 0;
    app = Fastify({ logger: false });
    registerSelfUpdateRoutes(app, {
      selfUpdate: fakeService(DISABLED_STATUS, () => { applied += 1; }),
    });
    await app.ready();
    const response = await app.inject({ method: "POST", url: "/api/pi-web/update/apply", payload: {} });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ started: true });
    expect(applied).toBe(1);
  });
});
// Command mode: the nix/managed deployment path. There is no checkout, so
// status stays simple and apply hands off to the command via systemd-run.

describe("self-update command mode", () => {
  afterEach(() => {
    delete process.env["PI_WEB_UPDATE_COMMAND"];
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

  it("reports enabled with the built version when a command is configured", async () => {
    process.env["PI_WEB_UPDATE_COMMAND"] = "/nix/store/xxx-pi-web-autoupdate/bin/pi-web-autoupdate --force";
    const service = createSelfUpdateService(undefined);
    const status = await service.status();
    expect(status.enabled).toBe(true);
    expect(status.current).toBe(packageVersion());
    expect(status.latest).toBeUndefined();
    expect(status.available).toBe(false);
  });

  it("still refuses to apply without a command and without a checkout", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-web-no-checkout-"));
    const cwd = process.cwd();
    try {
      // Outside a checkout: the repo root in this test environment is one.
      process.chdir(root);
      const service = createSelfUpdateService(undefined);
      await expect(service.apply()).rejects.toThrow(/no checkout/);
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("hands the configured command to systemd-run, detached", async () => {
    // Pinned to Linux: the detach strategy is platform-dependent, and this
    // suite must assert the same thing on a maintainer's Mac as in CI.
    withPlatform("linux");
    process.env["PI_WEB_UPDATE_COMMAND"] = "/nix/store/xxx/bin/pi-web-autoupdate --force";
    const spawnMock = vi.mocked(childProcess.spawn);
    spawnMock.mockClear();
    const service = createSelfUpdateService(undefined);
    await service.apply();
    expect(spawnMock).toHaveBeenCalledOnce();
    const [binary, args] = spawnMock.mock.calls[0] ?? [];
    expect(binary).toBe("systemd-run");
    // The env command reaches bash -lc verbatim; the unit name keeps the
    // apply identifiable in systemd's journal.
    expect(args).toEqual(expect.arrayContaining(["--unit=pi-web-self-update", "/bin/bash", "-lc"]));
    expect(args?.at(-1)).toBe("/nix/store/xxx/bin/pi-web-autoupdate --force");
  });

  it("falls back to a detached bash child on macOS, which has no systemd-run", async () => {
    withPlatform("darwin");
    process.env["PI_WEB_UPDATE_COMMAND"] = "/opt/homebrew/bin/pi-web-autoupdate --force";
    const spawnMock = vi.mocked(childProcess.spawn);
    spawnMock.mockClear();
    const service = createSelfUpdateService(undefined);
    await service.apply();
    expect(spawnMock).toHaveBeenCalledOnce();
    const [binary, args] = spawnMock.mock.calls[0] ?? [];
    expect(binary).toBe("/bin/bash");
    expect(args).toEqual(["-lc", "/opt/homebrew/bin/pi-web-autoupdate --force"]);
  });
});
