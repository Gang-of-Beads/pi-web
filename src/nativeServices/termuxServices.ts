import { posix as posixPath } from "node:path";
import { ownEnvironmentValue } from "../environment.js";
import type { ServiceLifecycleAction } from "./serviceAction.js";
import type { NativeServiceManagerRef, NativeServicePlan, NativeServicePlanService } from "./servicePlan.js";

/**
 * Termux (Android) services run under termux-services: runit's `runsvdir`
 * supervises one directory per service under `$PREFIX/var/service`, `sv`
 * controls them, and a `down` file keeps a service from starting by itself.
 *
 * Every Termux package is built for this one prefix, and the Termux app cannot
 * run from any other, so paths are derived from it rather than from the
 * caller's `PREFIX`.
 */
export const TERMUX_PREFIX = "/data/data/com.termux/files/usr";
export const termuxServiceRoot = posixPath.join(TERMUX_PREFIX, "var", "service");
const termuxScriptShell = posixPath.join(TERMUX_PREFIX, "bin", "sh");
const termuxBootScriptName = "pi-web-services";
const termuxBootAppPackage = "com.termux.boot";

/**
 * How long `sv` waits for a stop or restart. The session daemon drains
 * in-flight agent runs before it exits; this matches the 180 seconds the
 * systemd unit allows. runit never escalates to SIGKILL, so a longer drain
 * makes `sv` report a timeout while the service keeps stopping.
 */
const termuxServiceWaitSeconds = "180";

/** Termux sets both markers in every shell it starts, including Termux:Boot scripts and runsvdir's services. */
export function isTermuxEnvironment(environment: Readonly<Record<string, string | undefined>>): boolean {
  const version = ownEnvironmentValue(environment, "TERMUX_VERSION");
  return version !== undefined && version !== "" && ownEnvironmentValue(environment, "PREFIX") === TERMUX_PREFIX;
}

export function termuxServiceDirectory(ref: Pick<NativeServiceManagerRef, "termuxServiceName">): string {
  return posixPath.join(termuxServiceRoot, ref.termuxServiceName);
}

export function termuxRunScriptPath(ref: Pick<NativeServiceManagerRef, "termuxServiceName">): string {
  return posixPath.join(termuxServiceDirectory(ref), "run");
}

/** The one file PI WEB owns in `~/.termux/boot`; the user's other boot scripts are never touched. */
export function termuxBootScriptPath(home: string): string {
  return posixPath.join(home, ".termux", "boot", termuxBootScriptName);
}

const termuxServiceActionCommands: Readonly<Record<ServiceLifecycleAction, readonly string[]>> = {
  start: ["up"],
  stop: ["-v", "-w", termuxServiceWaitSeconds, "down"],
  restart: ["-w", termuxServiceWaitSeconds, "restart"],
};

/**
 * `sv` arguments for a lifecycle action. `sv` sends the command to every
 * service before it waits, so a restart started inside the session daemon's
 * terminal is already in runsv's hands when the daemon stops and takes the
 * terminal with it.
 */
export function termuxServiceActionArgs(action: ServiceLifecycleAction, directories: readonly string[]): string[] {
  return [...termuxServiceActionCommands[action], ...directories];
}

export interface TermuxRunScript {
  shellExecutable: string;
  environment: Readonly<Record<string, string>>;
  workingDirectory: string | null;
  shellCommand: string;
  logPath: string;
}

/**
 * A runit `run` script that starts the service command through the user's
 * login shell, like the systemd and launchd backends do. Output is appended to
 * the same log file launchd uses, which the process itself trims.
 */
export function renderTermuxRunScript(script: TermuxRunScript): string {
  return [
    `#!${termuxScriptShell}`,
    `exec >>${shellSingleQuote(script.logPath)} 2>&1`,
    ...Object.entries(script.environment).map(([key, value]) => `export ${shellSingleQuote(`${key}=${value}`)}`),
    ...(script.workingDirectory === null ? [] : [`cd ${shellSingleQuote(script.workingDirectory)} || exit 1`]),
    `exec ${shellSingleQuote(script.shellExecutable)} -lc ${shellSingleQuote(script.shellCommand)}`,
    "",
  ].join("\n");
}

export function renderTermuxServiceRunScript(
  plan: NativeServicePlan,
  service: NativeServicePlanService,
  logDirectory: string,
): string {
  if (!plan.services.includes(service)) {
    throw new Error(`Cannot render ${service.id}; it is not a member of the supplied native service plan.`);
  }
  if (plan.backend.kind !== "termux") {
    throw new Error(`Cannot render a termux-services run script from a ${plan.backend.kind} native service plan.`);
  }
  return renderTermuxRunScript({
    shellExecutable: plan.shell.executable,
    environment: service.environment,
    workingDirectory: service.workingDirectory,
    shellCommand: service.shellCommand,
    logPath: posixPath.join(logDirectory, service.manager.logName),
  });
}

/**
 * Read back a run script PI WEB rendered. The script is accepted only when
 * rendering the parsed values reproduces it byte for byte, so a hand-edited
 * script is reported as unrecognized instead of half-understood.
 */
export function parseTermuxRunScript(contents: string): TermuxRunScript | undefined {
  const statements = shellStatements(contents.slice(contents.indexOf("\n") + 1));
  if (statements === undefined) return undefined;
  const environment: Record<string, string> = {};
  let logPath: string | undefined;
  let workingDirectory: string | null = null;
  let command: { shellExecutable: string; shellCommand: string } | undefined;
  for (const words of statements) {
    const [first, second, third, fourth] = words;
    if (first === "exec" && words.length === 3 && second?.startsWith(">>") === true && third === "2>&1") {
      logPath = second.slice(2);
    } else if (first === "export" && words.length === 2 && second !== undefined && second.indexOf("=") > 0) {
      const separator = second.indexOf("=");
      environment[second.slice(0, separator)] = second.slice(separator + 1);
    } else if (first === "cd" && words.length === 5 && second !== undefined && third === "||") {
      workingDirectory = second;
    } else if (first === "exec" && words.length === 4 && second !== undefined && third === "-lc" && fourth !== undefined) {
      command = { shellExecutable: second, shellCommand: fourth };
    } else {
      return undefined;
    }
  }
  if (logPath === undefined || command === undefined) return undefined;
  const parsed: TermuxRunScript = { ...command, environment, workingDirectory, logPath };
  return renderTermuxRunScript(parsed) === contents ? parsed : undefined;
}

/**
 * The Termux:Boot script: hold a wake lock so Android does not suspend the
 * services, then start termux-services' supervisor, which starts every enabled
 * service. LOGDIR is exported for the user's other termux-services loggers.
 */
export function renderTermuxBootScript(): string {
  return [
    `#!${termuxScriptShell}`,
    "# Written by `pi-web install`; `pi-web uninstall` removes it.",
    posixPath.join(TERMUX_PREFIX, "bin", "termux-wake-lock"),
    `export SVDIR=${termuxServiceRoot} LOGDIR=${posixPath.join(TERMUX_PREFIX, "var", "log")}`,
    `exec ${posixPath.join(TERMUX_PREFIX, "bin", "service-daemon")} start`,
    "",
  ].join("\n");
}

export interface TermuxCommandOutput {
  status: number;
  stdout: string;
  stderr: string;
}

export type TermuxServiceState = "running" | "down" | "unsupervised" | "unrecognized";

export interface TermuxServiceStatus {
  state: TermuxServiceState;
  detail: string;
  pid: string | undefined;
}

/**
 * Classify `sv status <directory>`. A service no runsv supervises is
 * unsupervised, not down: runit cannot say whether a process is still running.
 */
export function termuxServiceStatus(result: TermuxCommandOutput): TermuxServiceStatus {
  const line = `${result.stdout}\n${result.stderr}`.split("\n").map((candidate) => candidate.trim()).find((candidate) => candidate !== "") ?? "";
  const running = /^run: [^\n]*?: \(pid ([0-9]+)\) (.*)$/u.exec(line);
  if (result.status === 0 && running !== null) return { state: "running", detail: "running", pid: running[1] };
  const down = /^(down|finish): [^\n]*?: (.*)$/u.exec(line);
  if (result.status === 0 && down !== null) return { state: "down", detail: `${down[1] ?? "down"} ${down[2] ?? ""}`.trim(), pid: undefined };
  if (/runsv not running|unable to open supervise\/ok/u.test(line)) {
    return { state: "unsupervised", detail: "not supervised: runsv is not running for this service", pid: undefined };
  }
  return { state: "unrecognized", detail: line === "" ? `sv exited with status ${String(result.status)}` : line, pid: undefined };
}

export type TermuxBootAppState = "installed" | "not-installed" | "unknown";

/** Android user ids partition app uids by 100000; `pm` refuses other users' package lists. */
export function termuxBootAppListArgs(uid: number): string[] {
  return ["list", "packages", "--user", String(Math.floor(uid / 100_000)), termuxBootAppPackage];
}

/** Classify `pm list packages` for the Termux:Boot app; anything but a clean answer is unknown. */
export function termuxBootAppState(result: TermuxCommandOutput): TermuxBootAppState {
  if (result.stdout.split("\n").some((line) => line.trim() === `package:${termuxBootAppPackage}`)) return "installed";
  return result.status === 0 && result.stderr.trim() === "" ? "not-installed" : "unknown";
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Split POSIX shell text into statements of unquoted words; enough to read back what `renderTermuxRunScript` writes. */
function shellStatements(text: string): string[][] | undefined {
  const statements: string[][] = [];
  let words: string[] = [];
  let word: string | undefined;
  let quoted = false;
  let escaped = false;
  for (const character of text) {
    if (quoted) {
      if (character === "'") quoted = false;
      else word = (word ?? "") + character;
    } else if (escaped) {
      word = (word ?? "") + character;
      escaped = false;
    } else if (character === "'") {
      quoted = true;
      word ??= "";
    } else if (character === "\\") {
      escaped = true;
    } else if (character === " " || character === "\n") {
      if (word !== undefined) words.push(word);
      word = undefined;
      if (character === "\n" && words.length > 0) {
        statements.push(words);
        words = [];
      }
    } else {
      word = (word ?? "") + character;
    }
  }
  if (quoted || escaped) return undefined;
  if (word !== undefined) words.push(word);
  if (words.length > 0) statements.push(words);
  return statements;
}
