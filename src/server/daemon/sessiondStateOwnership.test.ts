import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hostname, tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimSessiondStateOwnership,
  isOwnershipRecordAlive,
  parseOwnershipRecord,
  SessiondStateOwnershipConflictError,
  type SessiondStateOwnershipLostError,
  SESSIOND_OWNER_MARKER_FILENAME,
  type SessiondStateOwnershipLogger,
  type SessiondStateOwnershipRecord,
} from "./sessiondStateOwnership.js";
import { sessiondSocketPath } from "../shared/sessiondClient/config.js";
import { readProcessStartTime } from "./sessiondOwnerNamespace.js";

const DEAD_PID = 2 ** 30;
const OTHER_LIVE_PID = 424_242;

let dataDir: string;
let markerPath: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pi-web-ownership-test-"));
  markerPath = join(dataDir, SESSIOND_OWNER_MARKER_FILENAME);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** These cases end before the first heartbeat, so no loss can be reported. */
const ignoreOwnershipLoss = (): void => undefined;

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { PI_WEB_DATA_DIR: dataDir, ...overrides };
}

async function writeMarker(record: Partial<SessiondStateOwnershipRecord> & Pick<SessiondStateOwnershipRecord, "pid">): Promise<SessiondStateOwnershipRecord> {
  const full: SessiondStateOwnershipRecord = {
    startedAt: "2026-01-01T00:00:00.000Z",
    endpoint: join(dataDir, "sessiond.sock"),
    ...record,
  };
  await writeFile(markerPath, `${JSON.stringify(full)}\n`, "utf8");
  return full;
}

async function readMarker(): Promise<SessiondStateOwnershipRecord> {
  const parsed = parseOwnershipRecord(await readFile(markerPath, "utf8"));
  if (parsed === "invalid") throw new Error("expected a valid ownership marker");
  return parsed;
}

function collectingLogger(): SessiondStateOwnershipLogger & { entries: { level: string; message: string }[] } {
  const entries: { level: string; message: string }[] = [];
  return {
    entries,
    info: (_details, message) => { entries.push({ level: "info", message }); },
    warn: (_details, message) => { entries.push({ level: "warn", message }); },
  };
}

describe("claimSessiondStateOwnership", () => {
  it("claims unowned state, records the owner, and releases on request", async () => {
    const ownership = await claimSessiondStateOwnership({ onOwnershipLost: ignoreOwnershipLoss, env: env() });

    expect(ownership.markerPath).toBe(markerPath);
    const record = await readMarker();
    expect(record.pid).toBe(process.pid);
    expect(record.endpoint).toBe(sessiondSocketPath(env()));
    expect(Date.parse(record.startedAt)).not.toBeNaN();
    expect(record.namespace).toEqual(ownership.record.namespace);
    expect(record.namespace?.hostname).toBe(hostname());
    expect(record.heartbeatAt).toBe(record.startedAt);

    await ownership.release();
    await expect(readFile(markerPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("describes a TCP endpoint when a session daemon port is configured", async () => {
    const ownership = await claimSessiondStateOwnership({
      onOwnershipLost: ignoreOwnershipLoss,
      env: env({ PI_WEB_SESSIOND_PORT: "7800", PI_WEB_SESSIOND_HOST: "0.0.0.0" }),
    });

    expect(ownership.record.endpoint).toBe("0.0.0.0:7800");
  });

  it("takes over from a dead owner's stale marker", async () => {
    const stale = await writeMarker({ pid: DEAD_PID });
    const logger = collectingLogger();

    const ownership = await claimSessiondStateOwnership({ onOwnershipLost: ignoreOwnershipLoss, env: env(), logger });

    const record = await readMarker();
    expect(record.pid).toBe(process.pid);
    expect(record.startedAt).not.toBe(stale.startedAt);
    expect(logger.entries.some((entry) => entry.level === "info" && entry.message.includes("stale marker"))).toBe(true);
    await ownership.release();

    const host = { hostname: "box", pidNamespace: "pid:[4026531836]", bootId: "boot-2", machineIdHash: "a".repeat(64) };
    const claimAs = (options: { leaseMs?: number; isAlive?: () => boolean; ownNamespace?: typeof host & { pid1StartTime?: string } }) =>
      claimSessiondStateOwnership({ onOwnershipLost: ignoreOwnershipLoss, env: env(), ownNamespace: host, logger, pollIntervalMs: 10, graceMs: 100, ...options });
    await writeMarker({ pid: 1, namespace: { ...host, hostname: "renamed", bootId: "boot-1" }, heartbeatAt: "frozen" });
    await (await claimAs({ isAlive: () => true })).release();
    expect(logger.entries.some((entry) => entry.message.includes("before it restarted"))).toBe(true);
    await writeMarker({ pid: DEAD_PID, namespace: { hostname: "box", pidNamespace: "pid:[4026531836]", machineIdHash: host.machineIdHash } });
    const unknownBootStart = performance.now();
    await (await claimAs({ leaseMs: 5_000 })).release();
    expect(performance.now() - unknownBootStart).toBeLessThan(1_000);
    const reusedNamespace = { hostname: "replica-a", pidNamespace: "pid:[4026532001]", bootId: "boot-2", machineIdHash: host.machineIdHash };
    await writeMarker({ pid: process.pid, namespace: { ...reusedNamespace, pid1StartTime: "100" }, heartbeatAt: "frozen" });
    const foreignStart = performance.now();
    await (await claimAs({ leaseMs: 200, ownNamespace: { ...reusedNamespace, pid1StartTime: "200" } })).release();
    expect(performance.now() - foreignStart).toBeGreaterThanOrEqual(200);
    expect(logger.entries.some((entry) => entry.message.includes("heartbeat stopped"))).toBe(true);
  });

  it("reclaims its own previous marker without waiting", async () => {
    await writeMarker({ pid: process.pid });

    const ownership = await claimSessiondStateOwnership({ onOwnershipLost: ignoreOwnershipLoss, env: env(), graceMs: 50, pollIntervalMs: 10 });

    expect(ownership.record.pid).toBe(process.pid);
    expect((await readMarker()).startedAt).toBe(ownership.record.startedAt);
  });

  it("waits out the grace window for a live owner that releases, then claims", async () => {
    await writeMarker({ pid: OTHER_LIVE_PID });
    const logger = collectingLogger();
    // The simulated owner exits and its shutdown removes the marker shortly
    // after the claim starts waiting.
    const ownerReleases = setTimeout(() => { void rm(markerPath, { force: true }); }, 60);

    const ownership = await claimSessiondStateOwnership({
      onOwnershipLost: ignoreOwnershipLoss,
      env: env(),
      isAlive: () => true,
      graceMs: 2_000,
      pollIntervalMs: 20,
      logger,
    });
    clearTimeout(ownerReleases);

    expect((await readMarker()).pid).toBe(process.pid);
    expect(ownership.record.pid).toBe(process.pid);
    expect(logger.entries.filter((entry) => entry.message.includes("waiting briefly"))).toHaveLength(1);
  });

  it("fails loudly and actionably when a live owner persists past the grace window", async () => {
    const owner = await writeMarker({ pid: OTHER_LIVE_PID });

    const failure = await claimSessiondStateOwnership({
      onOwnershipLost: ignoreOwnershipLoss,
      env: env(),
      isAlive: () => true,
      graceMs: 250,
      pollIntervalMs: 20,
    }).then(
      () => { throw new Error("expected the claim to fail"); },
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(SessiondStateOwnershipConflictError);
    if (!(failure instanceof SessiondStateOwnershipConflictError)) throw new Error("expected an ownership conflict");
    expect(failure.owner).toEqual(owner);
    expect(failure.dataDir).toBe(dataDir);
    expect(failure.message).toContain(`pid ${String(OTHER_LIVE_PID)}`);
    expect(failure.message).toContain(owner.startedAt);
    expect(failure.message).toContain(dataDir);
    expect(failure.message).toContain("PI_WEB_DATA_DIR");
    expect(failure.message).toContain("PI_WEB_SESSIOND_SOCKET");
    expect(failure.message).toContain("PI_WEB_PORT");
    expect(failure.message).toContain("stale marker");
    // The live owner is untouched.
    expect((await readMarker()).pid).toBe(OTHER_LIVE_PID);

    const foreignOwner = { pid: OTHER_LIVE_PID, namespace: { hostname: "replica-a", pidNamespace: "pid:[4026532001]", bootId: "boot-1" } };
    let beats = 0;
    const beatAtomically = async (): Promise<void> => {
      const beat = String(beats++);
      const full = { startedAt: "2026-01-01T00:00:00.000Z", endpoint: "/other/sessiond.sock", ...foreignOwner, heartbeatAt: `beat-${beat}` };
      await writeFile(`${markerPath}.beat-${beat}`, `${JSON.stringify(full)}\n`, "utf8");
      await rename(`${markerPath}.beat-${beat}`, markerPath);
    };
    let lastBeat = beatAtomically();
    const heartbeat = setInterval(() => { lastBeat = lastBeat.then(beatAtomically); }, 30);
    await lastBeat;
    const foreignStart = performance.now();
    const foreignFailure = await claimSessiondStateOwnership({
      onOwnershipLost: ignoreOwnershipLoss,
      env: env(),
      ownNamespace: { hostname: "replica-b", pidNamespace: "pid:[4026532002]", bootId: "boot-1" },
      graceMs: 250,
      pollIntervalMs: 20,
      leaseMs: 5_000,
    }).then(
      () => { throw new Error("expected the claim to fail"); },
      (error: unknown) => error,
    );
    clearInterval(heartbeat);
    await lastBeat;
    expect(performance.now() - foreignStart).toBeGreaterThanOrEqual(250);
    expect(foreignFailure).toBeInstanceOf(SessiondStateOwnershipConflictError);
    if (!(foreignFailure instanceof SessiondStateOwnershipConflictError)) throw new Error("expected an ownership conflict");
    expect(foreignFailure.message).toContain('on host "replica-a", in another container or on another host');
    expect(foreignFailure.message).toContain("Give every host its own data directory");
    const foreignMarker = await readMarker();
    expect(foreignMarker.pid).toBe(OTHER_LIVE_PID);
    expect(foreignMarker.namespace).toEqual(foreignOwner.namespace);
  });

  it("discards an unreadable marker only after the grace window", async () => {
    await writeFile(markerPath, "not json {{{", "utf8");
    const logger = collectingLogger();

    const ownership = await claimSessiondStateOwnership({ onOwnershipLost: ignoreOwnershipLoss, env: env(), graceMs: 200, pollIntervalMs: 20, logger });

    expect((await readMarker()).pid).toBe(ownership.record.pid);
    expect(logger.entries.some((entry) => entry.level === "warn" && entry.message.includes("unreadable"))).toBe(true);
  });

  it("does not release a marker another owner has taken over", async () => {
    const losses: SessiondStateOwnershipLostError[] = [];
    const ownership = await claimSessiondStateOwnership({ onOwnershipLost: (error) => { losses.push(error); }, env: env(), heartbeatPeriodMs: 200 });
    const takeover = await writeMarker({ pid: OTHER_LIVE_PID, startedAt: "2026-02-02T00:00:00.000Z" });
    await vi.waitFor(() => { expect(losses).toHaveLength(1); });
    expect(losses[0]?.owner).toEqual(takeover);
    expect(losses[0]?.message).toContain(markerPath);

    await ownership.release();

    expect(await readMarker()).toEqual(takeover);
  });
});

describe("parseOwnershipRecord", () => {
  it("parses a record and tolerates unknown fields", () => {
    const parsed = parseOwnershipRecord(JSON.stringify({
      pid: 123,
      startedAt: "2026-01-01T00:00:00.000Z",
      processStartTime: "4567",
      endpoint: "/data/pi-web/sessiond.sock",
      namespace: { hostname: "replica-a", pidNamespace: "pid:[4026532200]", bootId: "boot-1", pid1StartTime: "1234", futureField: 1 },
      heartbeatAt: "2026-01-01T00:00:10.000Z",
      futureField: { anything: true },
    }));

    expect(parsed).toEqual({
      pid: 123,
      startedAt: "2026-01-01T00:00:00.000Z",
      processStartTime: "4567",
      endpoint: "/data/pi-web/sessiond.sock",
      namespace: { hostname: "replica-a", pidNamespace: "pid:[4026532200]", bootId: "boot-1", pid1StartTime: "1234" },
      heartbeatAt: "2026-01-01T00:00:10.000Z",
    });
    const fromNewerRelease = parseOwnershipRecord(JSON.stringify({
      pid: 123,
      startedAt: "x",
      endpoint: "y",
      namespace: { hostname: "h", pidNamespace: "pid:[1]", wsl: "future-kind", machineIdHash: 42, bootId: "b" },
    }));
    expect(fromNewerRelease).toEqual({ pid: 123, startedAt: "x", endpoint: "y", namespace: { hostname: "h", pidNamespace: "pid:[1]", bootId: "b" } });
  });

  it("rejects content that is not a readable ownership record", () => {
    expect(parseOwnershipRecord("not json")).toBe("invalid");
    expect(parseOwnershipRecord('"just a string"')).toBe("invalid");
    expect(parseOwnershipRecord(JSON.stringify({ pid: "123", startedAt: "x", endpoint: "y" }))).toBe("invalid");
    expect(parseOwnershipRecord(JSON.stringify({ pid: 123, endpoint: "y" }))).toBe("invalid");
    expect(parseOwnershipRecord(JSON.stringify({ pid: 123, startedAt: "x", endpoint: "y", processStartTime: 42 }))).toBe("invalid");
    expect(parseOwnershipRecord(JSON.stringify({ pid: 123, startedAt: "x", endpoint: "y", namespace: { pidNamespace: "pid:[1]" } }))).toBe("invalid");
    expect(parseOwnershipRecord(JSON.stringify({ pid: 123, startedAt: "x", endpoint: "y", heartbeatAt: 42 }))).toBe("invalid");
  });
});

describe("isOwnershipRecordAlive", () => {
  it("reports a nonexistent pid as dead", () => {
    expect(isOwnershipRecordAlive({ pid: DEAD_PID })).toBe(false);
  });

  it("reports a running process without a recorded start time as alive", () => {
    expect(isOwnershipRecordAlive({ pid: process.pid })).toBe(true);
  });

  it.skipIf(process.platform !== "linux")("matches a recorded start time against the live process", () => {
    const processStartTime = readProcessStartTime(process.pid);
    if (processStartTime === undefined) throw new Error("expected a /proc start time on Linux");

    expect(isOwnershipRecordAlive({ pid: process.pid, processStartTime })).toBe(true);
    // A reused pid reports a different start time than the recorded owner.
    expect(isOwnershipRecordAlive({ pid: process.pid, processStartTime: "1" })).toBe(false);
  });
});

describe("readProcessStartTime", () => {
  it.skipIf(process.platform !== "linux")("reads the current process's start-time ticks on Linux", () => {
    expect(readProcessStartTime(process.pid)).toMatch(/^\d+$/);
  });

  it("returns undefined for a nonexistent pid", () => {
    expect(readProcessStartTime(DEAD_PID)).toBeUndefined();
  });
});
