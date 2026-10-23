import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { manualRunReadiness } from "./manualRunDoctor.js";
import { parseContainerMounts, type ContainerMount } from "./server/shared/mountTable.js";

let root: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "pi-web-doctor-")));
  env = {
    PI_WEB_DATA_DIR: join(root, "data"),
    PI_WEB_CONFIG: join(root, "config", "config.json"),
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_WEB_SESSIOND_PORT: "8503",
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A container whose root is the image's overlay, with more mounts as [target, filesystem type]. */
function containerMounts(...mounts: readonly (readonly [string, string])[]): () => readonly ContainerMount[] {
  return () => parseContainerMounts([
    "1 0 0:1 / / rw,relatime - overlay overlay rw,lowerdir=/x,upperdir=/y",
    ...mounts.map(([target, fsType], index) => `${String(index + 2)} 1 8:9 / ${target} rw,relatime - ${fsType} /dev/sda9 rw`),
    "",
  ].join("\n"));
}

async function linesFor(readMountInfo: () => readonly ContainerMount[]): Promise<string> {
  const readiness = await manualRunReadiness(env, { readMountInfo });
  return readiness.lines.join("\n");
}

describe("manualRunReadiness state directory persistence", () => {
  it("warns when a writable state directory is on the container's own filesystem", async () => {
    const readiness = await manualRunReadiness(env, { readMountInfo: containerMounts() });
    const lines = readiness.lines.join("\n");

    expect(lines).toContain(`✓ PI WEB data directory writable: ${join(root, "data")}`);
    expect(lines).toContain(`! PI WEB data directory ${join(root, "data")} is on the container's own filesystem (overlay at /): writable now, but reset when the container is recreated.`);
    expect(lines).toContain("Mount a persistent volume there, or point PI_WEB_DATA_DIR at one.");
    expect(lines).toContain(`! pi agent directory ${join(root, "agent")} is on the container's own filesystem`);
    expect(lines).toContain("point PI_CODING_AGENT_DIR at one");
    expect(lines).toContain("point PI_WEB_CONFIG at one");
    expect(readiness.ok).toBe(true);
  });

  it("says nothing more when the state directories are on a volume", async () => {
    const lines = await linesFor(containerMounts([root, "ext4"]));

    expect(lines).not.toContain("reset when the container is recreated");
    expect(lines).not.toContain("in memory");
  });

  it("warns when a state directory is in memory", async () => {
    const lines = await linesFor(containerMounts([root, "ext4"], [join(root, "agent"), "tmpfs"]));

    expect(lines).toContain(`! pi agent directory ${join(root, "agent")} is in memory (tmpfs at ${join(root, "agent")}): lost when the container or the host restarts.`);
    expect(lines).not.toContain(`PI WEB data directory ${join(root, "data")} is in memory`);
  });

  it("follows a symbolic link onto a volume", async () => {
    mkdirSync(join(root, "volume", "data"), { recursive: true });
    symlinkSync(join(root, "volume", "data"), join(root, "data"));

    const lines = await linesFor(containerMounts([join(root, "volume"), "ext4"]));

    expect(lines).not.toContain(`PI WEB data directory ${join(root, "data")} is on the container's own filesystem`);
  });

  it("leaves a host whose root is not an image layer alone", async () => {
    const lines = await linesFor(() => parseContainerMounts("1 0 8:1 / / rw,relatime - ext4 /dev/sda1 rw\n"));

    expect(lines).not.toContain("reset when the container is recreated");
  });

  it("checks nothing more without a mount table", async () => {
    const lines = await linesFor(() => {
      throw new Error("no /proc here");
    });

    expect(lines).not.toContain("reset when the container is recreated");
    expect(lines).toContain(`✓ PI WEB data directory writable: ${join(root, "data")}`);
  });
});
