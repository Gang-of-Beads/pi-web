import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PiSessionService, type PiSessionListEntry } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeSessionManager, sessionRecord, testModelRuntime, type SessionGateway } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";
const CHILD_CWD = "/srv/dev/pi-web";
const PARENT_CWD = "/srv/dev/pi-web-feature";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-parent-location-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("PiSessionService.list parent locations", () => {
  it("reports the cwd and id of a parent living in another worktree", async () => {
    const parentFile = await parentSessionFile({ id: "parent-id", cwd: PARENT_CWD });
    const service = serviceListing([childRecord(parentFile)]);

    const [child] = await service.list(CHILD_CWD);

    expect(child).toMatchObject({ id: "child", parentSessionCwd: PARENT_CWD, parentSessionId: "parent-id" });
  });

  it("leaves sessions untouched when the parent is in the same workspace listing", async () => {
    const parent = sessionRecord("parent", CHILD_CWD);
    const child = { ...sessionRecord("child", CHILD_CWD), parentSessionPath: parent.path };
    const service = serviceListing([parent, child]);

    const listed = await service.list(CHILD_CWD);

    expect(listed.find((session) => session.id === "child")).not.toHaveProperty("parentSessionCwd");
  });

  it("does not annotate a parent whose file records the same cwd, since it is not elsewhere", async () => {
    const parentFile = await parentSessionFile({ id: "parent-id", cwd: CHILD_CWD });
    const service = serviceListing([childRecord(parentFile)]);

    const [child] = await service.list(CHILD_CWD);

    expect(child).not.toHaveProperty("parentSessionCwd");
    expect(child).toHaveProperty("parentSessionPath", parentFile);
  });

  it("still lists a child whose parent file is gone, without location fields", async () => {
    const service = serviceListing([childRecord(join(tempDir, "deleted-parent.jsonl"))]);

    const [child] = await service.list(CHILD_CWD);

    expect(child).toMatchObject({ id: "child" });
    expect(child).not.toHaveProperty("parentSessionCwd");
    expect(child).not.toHaveProperty("parentSessionId");
  });

  it("reads each parent header only once across repeated listings", async () => {
    const parentFile = await parentSessionFile({ id: "parent-id", cwd: PARENT_CWD });
    const service = serviceListing([childRecord(parentFile)]);
    await service.list(CHILD_CWD);

    // A cached header keeps the annotation after the file is removed, proving no
    // second read happened for the same path.
    await rm(parentFile);
    const [child] = await service.list(CHILD_CWD);

    expect(child).toMatchObject({ parentSessionCwd: PARENT_CWD, parentSessionId: "parent-id" });
  });

  it("releases cached headers on dispose so the cache cannot outlive the service", async () => {
    const parentFile = await parentSessionFile({ id: "parent-id", cwd: PARENT_CWD });
    const service = serviceListing([childRecord(parentFile)]);
    await service.list(CHILD_CWD);

    await service.dispose();
    await rm(parentFile);
    const [child] = await service.list(CHILD_CWD);

    expect(child).not.toHaveProperty("parentSessionCwd");
  });
});

describe("PiSessionService.list children in sibling workspaces", () => {
  it("counts children that live in other workspaces of the same project", async () => {
    const parent = sessionRecord("parent", CHILD_CWD);
    const service = serviceListing({
      [CHILD_CWD]: [parent],
      [PARENT_CWD]: [{ ...sessionRecord("child-a", PARENT_CWD), parentSessionPath: parent.path }, { ...sessionRecord("child-b", PARENT_CWD), parentSessionPath: parent.path }],
    }, [CHILD_CWD, PARENT_CWD]);

    const [listed] = await service.list(CHILD_CWD);

    expect(listed).toMatchObject({ id: "parent", childSessionsElsewhere: 2 });
  });

  it("does not count children nested in the same workspace listing", async () => {
    const parent = sessionRecord("parent", CHILD_CWD);
    const service = serviceListing({
      [CHILD_CWD]: [parent, { ...sessionRecord("child", CHILD_CWD), parentSessionPath: parent.path }],
      [PARENT_CWD]: [],
    }, [CHILD_CWD, PARENT_CWD]);

    const listed = await service.list(CHILD_CWD);

    expect(listed.find((session) => session.id === "parent")).not.toHaveProperty("childSessionsElsewhere");
  });

  it("skips sibling scanning when the cwd belongs to no registered project", async () => {
    const parent = sessionRecord("parent", CHILD_CWD);
    const service = serviceListing({
      [CHILD_CWD]: [parent],
      [PARENT_CWD]: [{ ...sessionRecord("child", PARENT_CWD), parentSessionPath: parent.path }],
    }, undefined);

    const [listed] = await service.list(CHILD_CWD);

    expect(listed).not.toHaveProperty("childSessionsElsewhere");
  });

  it("still lists sessions when a sibling workspace cannot be listed", async () => {
    const parent = sessionRecord("parent", CHILD_CWD);
    const service = serviceListing({ [CHILD_CWD]: [parent] }, [CHILD_CWD, PARENT_CWD], {
      listCwd: (cwd) => {
        if (cwd === PARENT_CWD) throw new Error("sibling workspace is gone");
        return undefined;
      },
    });

    const [listed] = await service.list(CHILD_CWD);

    expect(listed).toMatchObject({ id: "parent" });
    expect(listed).not.toHaveProperty("childSessionsElsewhere");
  });

  it("reports both an out-of-workspace parent and children elsewhere on one listing", async () => {
    const grandparentFile = await parentSessionFile({ id: "grandparent-id", cwd: PARENT_CWD });
    const middle = { ...sessionRecord("middle", CHILD_CWD), parentSessionPath: grandparentFile };
    const service = serviceListing({
      [CHILD_CWD]: [middle],
      [PARENT_CWD]: [{ ...sessionRecord("grandchild", PARENT_CWD), parentSessionPath: middle.path }],
    }, [CHILD_CWD, PARENT_CWD]);

    const [listed] = await service.list(CHILD_CWD);

    expect(listed).toMatchObject({ id: "middle", parentSessionCwd: PARENT_CWD, parentSessionId: "grandparent-id", childSessionsElsewhere: 1 });
  });
});

function childRecord(parentSessionPath: string) {
  return { ...sessionRecord("child", CHILD_CWD), parentSessionPath };
}

async function parentSessionFile(header: { id: string; cwd: string }): Promise<string> {
  const path = join(tempDir, `${header.id}.jsonl`);
  const lines = [
    JSON.stringify({ type: "session", version: 3, ...header }),
    JSON.stringify({ type: "model_change", id: "m1", parentId: null }),
  ];
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

type SessionRecord = PiSessionListEntry;

/**
 * Build a service over per-cwd session listings. `projectCwds` is the workspace
 * set of the containing project, or undefined to model an unregistered cwd.
 */
function serviceListing(
  recordsByCwd: SessionRecord[] | Record<string, SessionRecord[]>,
  projectCwds?: string[],
  options: { listCwd?: (cwd: string) => void } = {},
): PiSessionService {
  const listings = Array.isArray(recordsByCwd) ? { [CHILD_CWD]: recordsByCwd } : recordsByCwd;
  const gateway: SessionGateway = {
    create: () => fakeSessionManager(),
    list: (cwd: string) => {
      options.listCwd?.(cwd);
      return Promise.resolve(listings[cwd] ?? []);
    },
    open: () => fakeSessionManager(),
  };
  return new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    archiveStore: emptyArchiveStore(),
    sessionManager: gateway,
    heartbeatIntervalMs: 60_000,
    projectWorkspaces: { forCwd: () => Promise.resolve(projectCwds) },
  });
}
