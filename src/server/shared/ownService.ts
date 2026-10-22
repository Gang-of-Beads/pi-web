import { execFile } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { PiWebOwnService } from "../../shared/apiTypes.js";
import { nativeServiceBackendKind } from "../../nativeServices/serviceBackendKind.js";
import { launchdRuntimeDetails } from "../../nativeServices/launchdPrint.js";
import type { NativeServiceBackendKind } from "../../nativeServices/servicePlan.js";

/**
 * What one process can read about itself to tell which service the service manager started it
 * as. Both the web/API process and the session daemon read their own, so each reports for its
 * own component.
 */
export interface OwnServiceProbe {
  readonly platform: NodeJS.Platform;
  readonly pid: number;
  readonly ppid: number;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readText: (path: string) => string | undefined;
  readonly readLink: (path: string) => string | undefined;
  /** The unit's main PID as the user's systemd answers it; undefined when it does not answer. */
  readonly systemdMainPid: (unit: string) => Promise<string | undefined>;
  /** The pid launchd started the job as, from `launchctl print gui/<uid>/<label>`; undefined when it does not answer. */
  readonly launchdServicePid: (label: string) => Promise<string | undefined>;
}

const execFileAsync = promisify(execFile);
const MANAGER_QUERY_TIMEOUT_MS = 5_000;

export function processOwnServiceProbe(env: Readonly<Record<string, string | undefined>> = process.env): OwnServiceProbe {
  return {
    platform: process.platform,
    pid: process.pid,
    ppid: process.ppid,
    env,
    readText: readTextOrUndefined,
    readLink: readLinkOrUndefined,
    systemdMainPid: async (unit) => (await managerAnswer("systemctl", ["--user", "show", "--property=MainPID", "--value", unit], env))?.trim(),
    launchdServicePid: async (label) => {
      const output = await managerAnswer("launchctl", ["print", `gui/${String(process.getuid?.() ?? "")}/${label}`], env);
      return output === undefined ? undefined : launchdRuntimeDetails(output).pid;
    },
  };
}

async function managerAnswer(command: string, args: readonly string[], env: Readonly<Record<string, string | undefined>>): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(command, args, { encoding: "utf8", timeout: MANAGER_QUERY_TIMEOUT_MS, env: { ...env } });
    return stdout;
  } catch {
    return undefined;
  }
}

function readTextOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function readLinkOrUndefined(path: string): string | undefined {
  try {
    return readlinkSync(path);
  } catch {
    return undefined;
  }
}

/** A reading, and whether it rests on a service-manager query that did not answer, which a later read may ask again. */
interface OwnServiceReading {
  readonly service: PiWebOwnService;
  readonly managerDidNotAnswer: boolean;
}

const NONE: OwnServiceReading = { service: { kind: "none" }, managerDidNotAnswer: false };
const UNKNOWN: OwnServiceReading = { service: { kind: "unknown" }, managerDidNotAnswer: false };
const NO_ANSWER: OwnServiceReading = { service: { kind: "unknown" }, managerDidNotAnswer: true };

/**
 * Each backend's proof that this process is its service's main process, not merely inside it.
 * systemd puts every descendant in the unit's cgroup and passes SYSTEMD_EXEC_PID down, so only
 * the pid it names is the unit's own process; systemd before 248 sets none, and the unit's
 * MainPID, asked of systemd, decides instead. launchd passes XPC_SERVICE_NAME down to every
 * descendant and adopts every orphan, so only the pid `launchctl print` reports for the job is
 * its own. runsv is the parent of the service it runs, from inside the service's directory (its
 * argument is `./`). A manager that does not answer leaves the service unknown. Windows is not read:
 * its Updates page restart is `pi-web restart`, offered as before.
 */
const ownServiceReaders: Readonly<Record<NativeServiceBackendKind, (probe: OwnServiceProbe) => Promise<OwnServiceReading>>> = {
  systemd: systemdService,
  launchd: launchdService,
  termux: (probe) => Promise.resolve(termuxService(probe)),
  windows: () => Promise.resolve(UNKNOWN),
};

async function readOwnService(probe: OwnServiceProbe): Promise<OwnServiceReading> {
  const backend = nativeServiceBackendKind(probe.platform, probe.env);
  return backend === undefined ? NONE : await ownServiceReaders[backend](probe);
}

export async function ownService(probe: OwnServiceProbe = processOwnServiceProbe()): Promise<PiWebOwnService> {
  return (await readOwnService(probe)).service;
}

const MANAGER_RETRY_MS = 60_000;

/**
 * The service a long-lived process reports for itself. The first read caches the answer; a reading
 * that rests on a manager query that did not answer (systemd's user bus not up yet when the
 * session daemon starts) is read again, at most once a minute, instead of staying unknown until
 * the next restart.
 */
export interface OwnServiceReader {
  read(): Promise<PiWebOwnService>;
  /** Reads at startup, so the first report does not wait on a service-manager query. */
  prime(): Promise<void>;
}

export function ownServiceReader(probe: OwnServiceProbe, now: () => number = Date.now): OwnServiceReader {
  let last: { reading: Promise<OwnServiceReading>; at: number } | undefined;
  const read = async (): Promise<PiWebOwnService> => {
    const previous = last === undefined ? undefined : await last.reading;
    if (last === undefined || (previous?.managerDidNotAnswer === true && now() - last.at >= MANAGER_RETRY_MS)) {
      last = { reading: readOwnService(probe), at: now() };
    }
    return (await last.reading).service;
  };
  return { read, prime: async () => { await read(); } };
}

async function systemdService(probe: OwnServiceProbe): Promise<OwnServiceReading> {
  const cgroup = probe.readText(`/proc/${String(probe.pid)}/cgroup`);
  if (cgroup === undefined) return UNKNOWN;
  const unit = systemdUserUnit(cgroup);
  if (unit === undefined) return NONE;
  const execPid = probe.env["SYSTEMD_EXEC_PID"];
  if (execPid !== undefined) return mainPidReading(unit, execPid, probe.pid);
  return mainPidReading(unit, await probe.systemdMainPid(unit), probe.pid);
}

function mainPidReading(name: string, mainPid: string | undefined, pid: number): OwnServiceReading {
  if (mainPid === undefined) return NO_ANSWER;
  return mainPid === String(pid) ? { service: { kind: "service", name }, managerDidNotAnswer: false } : UNKNOWN;
}

/** The innermost service of the user manager in this process's systemd cgroup path, on the unified or the legacy hierarchy. */
function systemdUserUnit(cgroup: string): string | undefined {
  const path = cgroup.split("\n").map((line) => /^\d+:(?<controllers>[^:]*):(?<path>.*)$/u.exec(line)?.groups)
    .find((groups) => groups?.["controllers"] === "" || groups?.["controllers"] === "name=systemd")?.["path"];
  const segments = path?.split("/") ?? [];
  const manager = segments.findIndex((segment) => /^user@\d+\.service$/u.test(segment));
  if (manager === -1) return undefined;
  return segments.slice(manager + 1).filter((segment) => segment.endsWith(".service")).at(-1);
}

async function launchdService(probe: OwnServiceProbe): Promise<OwnServiceReading> {
  const label = probe.env["XPC_SERVICE_NAME"];
  if (label === undefined || label === "" || label === "0") return NONE;
  return mainPidReading(label, await probe.launchdServicePid(label), probe.pid);
}

function termuxService(probe: OwnServiceProbe): OwnServiceReading {
  const [command] = probe.readText(`/proc/${String(probe.ppid)}/cmdline`)?.split("\0") ?? [];
  if (command === undefined || basename(command) !== "runsv") return UNKNOWN;
  const directory = probe.readLink(`/proc/${String(probe.ppid)}/cwd`);
  if (directory === undefined || basename(directory) === "") return UNKNOWN;
  return { service: { kind: "service", name: basename(directory) }, managerDidNotAnswer: false };
}
