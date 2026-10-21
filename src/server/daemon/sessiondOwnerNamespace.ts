/**
 * Identity of the PID namespace a session daemon runs in.
 *
 * A pid in the ownership marker only means something inside the namespace that
 * wrote it: a replica in another container on the same volume sees a different
 * process table, where a pid probe reads a live owner as dead (or the same pid
 * number as itself). The identity lets a claimant tell "my process table" from
 * "another one" before it trusts a pid probe.
 *
 * On Linux, `/proc/self/ns/pid` names the namespace. Its inode is unique only
 * per kernel (every host's initial namespace has the same inode), so the boot
 * id, or the hostname when the boot id is unreadable, pins down the kernel.
 * Containers sharing the host's PID namespace compare as the same namespace
 * whatever their hostnames.
 *
 * Plain hosts must start exactly as before the lease. A host's initial
 * namespace keeps its inode across a reboot while the boot id changes, so a
 * marker from there with this machine's id and another boot id is this host
 * before it restarted, and its process is gone. The machine id
 * (`/etc/machine-id`), not the hostname, says "this machine": two hosts may
 * share a name, and a laptop's DHCP name changes between networks. A WSL2
 * distro runs in its own PID namespace inside a utility VM that every
 * `wsl --shutdown` or Windows restart reboots, and a distro restarted inside a
 * running VM gets a new namespace under the same boot id; one distro runs one
 * instance at a time, so a marker with its machine id from any other
 * namespace is its previous instance. Containers keep the hostname: images
 * can share a machine id, and within one VM boot the boot id is shared, so two
 * Docker Desktop containers still compare as foreign. Without `/proc` (macOS,
 * Windows) there is no namespace to compare, and a hostname can change with
 * the network, so two such markers are judged by pid alone, as they always
 * were.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { hostname } from "node:os";
import { isRecord } from "../../shared/unknownValues.js";

export interface SessiondOwnerNamespace {
  readonly hostname: string;
  /** `/proc/self/ns/pid` link target, for example `pid:[4026531836]`. */
  readonly pidNamespace?: string;
  /** `/proc/sys/kernel/random/boot_id`: one value per running kernel. */
  readonly bootId?: string;
  /**
   * Start ticks of this namespace's PID 1 (`/proc/1/stat` field 22): one
   * value per namespace instance. The kernel reuses a freed namespace's inode
   * number, so a container killed and started in place on an idle host gets
   * the same `pidNamespace`; its new PID 1 started later, so this tells the
   * two apart. A host's initial namespace keeps one PID 1 for the whole boot.
   * Absent when `/proc/1/stat` is hidden (`hidepid`).
   */
  readonly pid1StartTime?: string;
  /**
   * Present on a WSL2 kernel: `distro` for a WSL distro itself (its runtime
   * directory `/run/WSL` exists), `container` for anything else on that
   * kernel, such as a Docker Desktop container.
   */
  readonly wsl?: WslRole;
  /**
   * SHA-256 of an application key and `/etc/machine-id` (or the D-Bus copy):
   * one value per installed system, stable across reboots. machine-id(5) calls
   * the raw id confidential and asks applications to hash it with their own
   * key, and the marker lives on shared volumes and is logged on takeovers,
   * so the raw id is never stored or logged.
   */
  readonly machineIdHash?: string;
}

type WslRole = "distro" | "container";

const WSL_ROLES: readonly WslRole[] = ["distro", "container"];

export function readOwnNamespace(): SessiondOwnerNamespace {
  const pidNamespace = readOrUndefined(() => readlinkSync("/proc/self/ns/pid"));
  const bootId = readOrUndefined(() => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim());
  const pid1StartTime = readProcessStartTime(1);
  const wsl = readWslRole();
  const machineIdHash = readMachineIdHash();
  return {
    hostname: hostname(),
    ...(pidNamespace === undefined ? {} : { pidNamespace }),
    ...(bootId === undefined ? {} : { bootId }),
    ...(pid1StartTime === undefined ? {} : { pid1StartTime }),
    ...(wsl === undefined ? {} : { wsl }),
    ...(machineIdHash === undefined ? {} : { machineIdHash }),
  };
}

/**
 * Linux-only precise process identity: `/proc/<pid>/stat` field 22 (start time
 * in clock ticks since boot). `undefined` off Linux or when the process is
 * gone or hidden. The `comm` field may contain spaces and parentheses, so
 * parsing starts after its closing parenthesis.
 */
export function readProcessStartTime(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen === -1) return undefined;
    const afterComm = stat.slice(closeParen + 2).split(" ");
    return afterComm[19];
  } catch {
    return undefined;
  }
}

const MACHINE_ID_FILES = ["/etc/machine-id", "/var/lib/dbus/machine-id"];

const MACHINE_ID_HASH_KEY = "pi-web-sessiond-owner:";

/** A first-boot placeholder such as `uninitialized` is no identity, so only a 32-hex id counts. */
function readMachineIdHash(): string | undefined {
  for (const path of MACHINE_ID_FILES) {
    const value = readOrUndefined(() => readFileSync(path, "utf8").trim());
    if (value !== undefined && /^[0-9a-f]{32}$/.test(value)) return createHash("sha256").update(MACHINE_ID_HASH_KEY + value).digest("hex");
  }
  return undefined;
}

function readWslRole(): WslRole | undefined {
  const release = readOrUndefined(() => readFileSync("/proc/sys/kernel/osrelease", "utf8"));
  if (release === undefined || !/microsoft|wsl/i.test(release)) return undefined;
  return existsSync("/run/WSL") ? "distro" : "container";
}

/** The initial PID namespace's inode, `PROC_PID_INIT_INO`, fixed in every Linux kernel. */
const INITIAL_PID_NAMESPACE = "pid:[4026531836]";

/**
 * One recorded namespace as a string, for a claim's identity: the same
 * daemon's record always produces the same key. Whether two namespaces are
 * one process table is {@link relateOwnerNamespace}'s question, not this
 * key's: it must not read an id one side could not record as a difference.
 */
export function ownerNamespaceKey(namespace: SessiondOwnerNamespace): string {
  if (namespace.pidNamespace === undefined) return "no-proc";
  const instance = namespace.pid1StartTime === undefined ? "" : `#${namespace.pid1StartTime}`;
  return `${namespace.pidNamespace}${instance}@${namespace.bootId ?? namespace.hostname}`;
}

/**
 * How a marker's namespace relates to this daemon's: `same` and
 * `previous-boot` are this host's own process table (now, or before a
 * restart), `foreign` is another container or host whose pids mean nothing
 * here.
 */
export type OwnerNamespaceRelation = "same" | "previous-boot" | "foreign";

export function relateOwnerNamespace(marker: SessiondOwnerNamespace, own: SessiondOwnerNamespace): OwnerNamespaceRelation {
  if (isSameNamespaceInstance(marker, own)) return "same";
  return hostRules[ownerHostKind(own)].relate(marker, own);
}

/**
 * One process table, so a pid probe can judge the owner. Absence is not
 * negation: an id one daemon could not read (`hidepid`, `ProtectProc`,
 * `ProcSubset=pid`) says nothing about the other's, so the boot id and PID
 * 1's start time count only when both sides recorded them. Without both boot
 * ids the hostname tells kernels apart, as it always did.
 */
function isSameNamespaceInstance(marker: SessiondOwnerNamespace, own: SessiondOwnerNamespace): boolean {
  if (marker.pidNamespace === undefined || own.pidNamespace === undefined) return marker.pidNamespace === own.pidNamespace;
  return marker.pidNamespace === own.pidNamespace
    && (marker.bootId !== undefined && own.bootId !== undefined ? marker.bootId === own.bootId : marker.hostname === own.hostname)
    && (marker.pid1StartTime === undefined || own.pid1StartTime === undefined || marker.pid1StartTime === own.pid1StartTime);
}

/**
 * Whether a claim waits to see that another claimant did not take the
 * directory at the same moment. Plain hosts start as before the lease and
 * never wait; containers, which may be replicas on a shared volume, do.
 */
export function claimSettles(namespace: SessiondOwnerNamespace): boolean {
  return hostRules[ownerHostKind(namespace)].settles;
}

type OwnerHostKind = "no-proc" | "plain-linux" | "wsl-distro" | "wsl-container" | "container";

const wslHostKinds: Record<WslRole, OwnerHostKind> = { distro: "wsl-distro", container: "wsl-container" };

function ownerHostKind(namespace: SessiondOwnerNamespace): OwnerHostKind {
  if (namespace.pidNamespace === undefined) return "no-proc";
  if (namespace.wsl !== undefined) return wslHostKinds[namespace.wsl];
  return namespace.pidNamespace === INITIAL_PID_NAMESPACE ? "plain-linux" : "container";
}

interface OwnerHostRules {
  readonly settles: boolean;
  /**
   * How a marker whose namespace key differs from this daemon's relates to it.
   * A marker without a PID namespace is never this table for a claimant that
   * has one: its pid cannot be probed here (a sandbox that hides
   * `/proc/self/ns/pid` writes such markers), so only the lease judges it.
   */
  relate(marker: SessiondOwnerNamespace, own: SessiondOwnerNamespace): OwnerNamespaceRelation;
}

const hostRules: Record<OwnerHostKind, OwnerHostRules> = {
  "no-proc": { settles: false, relate: () => "foreign" },
  "plain-linux": { settles: false, relate: relateOnPlainLinux },
  "wsl-distro": {
    settles: false,
    relate: (marker, own) => (marker.wsl === "distro" && marker.pidNamespace !== undefined && isPreviousDistroInstance(marker, own) ? "previous-boot" : "foreign"),
  },
  "wsl-container": {
    settles: true,
    relate: (marker, own) => (marker.wsl !== undefined && marker.pidNamespace !== undefined && marker.hostname === own.hostname && isNewBoot(marker, own) ? "previous-boot" : "foreign"),
  },
  container: { settles: true, relate: () => "foreign" },
};

/**
 * This machine's initial namespace in another boot is its previous boot. When
 * one side cannot read its boot id (a unit that hides `/proc/sys`), the keys
 * differ although both are this machine's initial namespace and nothing says
 * a reboot happened, so it is this process table and the pid probe decides,
 * as before the lease.
 */
function relateOnPlainLinux(marker: SessiondOwnerNamespace, own: SessiondOwnerNamespace): OwnerNamespaceRelation {
  if (marker.pidNamespace !== INITIAL_PID_NAMESPACE || !isSameMachine(marker, own)) return "foreign";
  return isNewBoot(marker, own) ? "previous-boot" : "same";
}

/** By machine id when both sides record one; a marker or system without it falls back to the hostname. */
function isSameMachine(marker: SessiondOwnerNamespace, own: SessiondOwnerNamespace): boolean {
  if (marker.machineIdHash !== undefined && own.machineIdHash !== undefined) return marker.machineIdHash === own.machineIdHash;
  return marker.hostname === own.hostname;
}

/**
 * After a new VM boot every process of the old one is gone, so the machine
 * match may fall back to the hostname. Within one VM boot the marker may come
 * from another live distro, and distros share the Windows hostname by
 * default, so only an equal recorded machine id makes it this distro's
 * previous instance.
 */
function isPreviousDistroInstance(marker: SessiondOwnerNamespace, own: SessiondOwnerNamespace): boolean {
  if (isNewBoot(marker, own)) return isSameMachine(marker, own);
  return marker.machineIdHash !== undefined && marker.machineIdHash === own.machineIdHash;
}

function isNewBoot(marker: SessiondOwnerNamespace, own: SessiondOwnerNamespace): boolean {
  return marker.bootId !== undefined && own.bootId !== undefined && marker.bootId !== own.bootId;
}

/**
 * Only a missing hostname makes a namespace unreadable. A value this version
 * does not know (a newer release's `wsl` kind, an id of another type) reads as
 * absent, which falls back to the stricter rules, so a rolled-back replica
 * still sees a live owner instead of discarding an "unreadable" marker.
 */
export function parseOwnerNamespace(value: unknown): SessiondOwnerNamespace | "invalid" {
  if (!isRecord(value) || typeof value["hostname"] !== "string") return "invalid";
  const pidNamespace = optionalString(value["pidNamespace"]);
  const bootId = optionalString(value["bootId"]);
  const pid1StartTime = optionalString(value["pid1StartTime"]);
  const machineIdHash = optionalString(value["machineIdHash"]);
  const wsl = WSL_ROLES.find((role) => role === value["wsl"]);
  return {
    hostname: value["hostname"],
    ...(pidNamespace === undefined ? {} : { pidNamespace }),
    ...(bootId === undefined ? {} : { bootId }),
    ...(pid1StartTime === undefined ? {} : { pid1StartTime }),
    ...(wsl === undefined ? {} : { wsl }),
    ...(machineIdHash === undefined ? {} : { machineIdHash }),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readOrUndefined(read: () => string): string | undefined {
  try {
    const value = read();
    return value === "" ? undefined : value;
  } catch {
    return undefined;
  }
}
