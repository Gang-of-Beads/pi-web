import { describe, expect, it } from "vitest";
import { mountContaining, parseContainerMounts } from "./mountTable.js";

/** A container's table: the image's overlay root, kernel filesystems, a volume and a tmpfs. */
const MOUNT_INFO = [
  "1 0 0:1 / / rw,relatime - overlay overlay rw,lowerdir=/x,upperdir=/y",
  "2 1 0:2 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw",
  "3 1 0:3 / /sys ro,nosuid,nodev,noexec,relatime - sysfs sysfs ro,seclabel",
  "4 1 8:9 /data /data rw,relatime - ext4 /dev/sda9 rw,seclabel",
  "5 1 0:4 / /data/cache rw,nosuid,nodev - tmpfs tmpfs rw",
  "6 1 0:5 / /host ro,relatime - btrfs /dev/sda9 rw,seclabel",
  "",
].join("\n");

describe("parseContainerMounts", () => {
  it("reads mount target, filesystem type, and read-only state", () => {
    const mounts = parseContainerMounts(MOUNT_INFO);

    expect(mounts).toContainEqual({ target: "/host", fsType: "btrfs", readOnly: true });
    expect(mounts).toContainEqual({ target: "/data", fsType: "ext4", readOnly: false });
    expect(mounts).toContainEqual({ target: "/proc", fsType: "proc", readOnly: false });
  });

  it("unescapes octal sequences in mount targets and skips unparsable lines", () => {
    const parsed = parseContainerMounts([
      "1 0 8:9 / /host\\040paths rw,relatime - ext4 /dev/sda9 rw",
      "not a mountinfo line",
      "",
    ].join("\n"));

    expect(parsed).toEqual([{ target: "/host paths", fsType: "ext4", readOnly: false }]);
  });
});

describe("mountContaining", () => {
  const mounts = parseContainerMounts(MOUNT_INFO);

  it("finds the most specific mount that holds a path", () => {
    expect(mountContaining("/data/pi-web", mounts)?.fsType).toBe("ext4");
    expect(mountContaining("/data/cache/x", mounts)?.fsType).toBe("tmpfs");
    expect(mountContaining("/data", mounts)?.target).toBe("/data");
    expect(mountContaining("/home/user/.pi-web", mounts)?.target).toBe("/");
  });

  it("does not take a sibling sharing a prefix for a parent", () => {
    expect(mountContaining("/database", mounts)?.target).toBe("/");
  });

  it("takes the later mount when a target is mounted over", () => {
    const stacked = parseContainerMounts([
      "1 0 0:1 / / rw - overlay overlay rw",
      "2 1 8:9 /data /data rw - ext4 /dev/sda9 rw",
      "3 2 0:4 / /data rw - tmpfs tmpfs rw",
      "",
    ].join("\n"));

    expect(mountContaining("/data/x", stacked)?.fsType).toBe("tmpfs");
  });
});
