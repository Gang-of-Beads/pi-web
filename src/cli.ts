#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { environmentOutsideSession, hostingServiceId } from "./nativeServices/serviceEnvironment.js";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPiWebConfigPath, defaultPiWebDataDir, examplePiWebConfig, piWebTlsConfig } from "./config.js";
import { readTlsCredentials } from "./server/shared/tlsCredentials.js";
import { printAccessTokenCheck } from "./accessTokenDoctor.js";
import { errorMessage as describeError } from "./shared/unknownValues.js";
import { piWebDockerCommand, type PiWebDockerMode } from "./docker/piWebDockerCommandPlan.js";
import { ownEnvironmentValue } from "./environment.js";
import { runPluginRecoveryCli, type SessionDaemonRestartPlan } from "./pluginRecoveryCli.js";
import { manualRunReadiness } from "./manualRunDoctor.js";
import { foregroundRunRefusal, foregroundRunRefusalMessages, pid1Warning, runForeground } from "./foregroundRun.js";
import { isRecord } from "./shared/unknownValues.js";
import {
  packageVersion,
  printPiWebVersionReport,
  probeRunningComponentReady,
  runningComponentsReady,
  type PiWebVersionReportOptions,
  type RunningComponentId,
} from "./piWebVersionReport.js";
import { checkNodePtyDarwinSpawnHelper, formatNodePtyDarwinSpawnHelperCheck } from "./server/shared/diagnostics/nodePtySpawnHelper.js";
import { checkNodePtyNativeModule, formatNodePtyNativeModuleCheck, type NodePtyLoadFailureSeverity } from "./server/shared/diagnostics/nodePtyNativeModule.js";
import { deploymentServiceEnvironment } from "./nativeServices/serviceEnvironment.js";
import {
  installNativeServiceCandidate,
  nativeServiceInstallFailureNeedsPathAdvice,
  type NativeServiceInstallCandidate,
  type NativeServiceInstallFailure,
} from "./nativeServices/serviceInstall.js";
import {
  launchdBootoutArgs,
  launchdBootstrapArgs,
  reloadLaunchdServicesForInstall,
  restartsInPlace,
  launchdServiceTarget,
  orderServices,
  performServiceAction,
  serviceStartOrder,
  serviceStopOrder,
  type LaunchdServiceContext,
  type ServiceActionDeps,
  type ServiceActionInput,
  type ServiceActionResult,
  type ServiceLifecycleAction,
} from "./nativeServices/serviceAction.js";
import {
  minimumSupportedNodeVersion,
  nativeServiceManagerRefs,
  productionNativeServiceIds,
  type NativeServiceAuthoritativeProbe,
  type NativeServiceBackend,
  type NativeServiceBackendKind,
  type NativeServiceId,
  type NativeServiceManagerRef,
  type NativeServicePlan,
  type NativeServiceShell,
  type ProductionNativeServicePlanInput,
} from "./nativeServices/servicePlan.js";
import {
  inspectInstalledNativeServiceDefinitions,
  type InstalledNativeServiceDefinitionCommandResult,
  type InstalledNativeServiceDefinitionPurpose,
  type InstalledNativeServiceDefinitionSource,
} from "./nativeServices/installedServiceDefinitions.js";
import {
  formatNativeServiceDoctorResult,
  inferInstalledNativeServiceMode,
  inspectInstalledDevelopmentServiceInput,
  inspectInstalledProductionServiceContext,
  runNativeServiceDoctor,
  selectManagedNativeServiceConfig,
  type InstalledNativeServiceDefinition,
  type InstalledNativeServiceInspection,
  type NativeServiceDoctorReport,
  type NativeServiceDoctorTarget,
} from "./nativeServices/serviceDoctor.js";
import {
  createNativeServiceAuthoritativeProbe,
  nativeServicePrerequisiteShellCheck,
} from "./nativeServices/serviceProbe.js";
import { renderLaunchdOneShotPlist, renderLaunchdPlist, renderSystemdUnit } from "./nativeServices/serviceRendering.js";
import { nativeServiceBackendKind, systemdBooted } from "./nativeServices/serviceBackendKind.js";
import { installTermuxServices, uninstallTermuxServices } from "./nativeServices/termuxServiceInstall.js";
import {
  isTermuxEnvironment,
  termuxBootAppListArgs,
  termuxBootAppState,
  termuxBootScriptPath,
  termuxRunScriptPath,
  termuxServiceActionArgs,
  termuxServiceDirectory,
  termuxServiceStatus,
  type TermuxBootAppState,
  type TermuxServiceState,
} from "./nativeServices/termuxServices.js";
import { followLogFiles } from "./nativeServices/logFollow.js";
import { createWindowsTaskProbe } from "./nativeServices/windowsTaskProbe.js";
import {
  parseWindowsTaskContext,
  parseWindowsTaskQuery,
  powerShellLiteral,
  readInstalledWindowsTaskStartMode,
  renderWindowsTaskLauncher,
  renderWindowsTaskXml,
  windowsCallerCommandScript,
  windowsCallerNodeVersionScript,
  windowsCallerPrerequisiteScript,
  windowsCliHandOffRegisterScript,
  windowsCliHandOffScript,
  windowsCliHandOffTaskName,
  windowsCliHandOffTaskNames,
  windowsCliHandOffVerbs,
  windowsIdleTaskUnregisterScript,
  windowsInstallStartMode,
  windowsLauncherDirectory,
  windowsPowerShell,
  windowsPowerShellArguments,
  windowsServiceManagementAccess,
  windowsServiceTaskDefinition,
  windowsTaskContextScript,
  windowsTaskDetail,
  windowsTaskHealth,
  windowsTaskQueryScript,
  windowsTaskRegisterScript,
  windowsTaskServiceShell,
  windowsTaskStartModeInUse,
  windowsTaskStartScript,
  windowsTaskStopScript,
  windowsTaskUnregisterScript,
  windowsUserSidFromWhoami,
  windowsUserTaskName,
  type InstalledWindowsTaskStartMode,
  type WindowsCliHandOffVerb,
  type WindowsServiceManagementAccess,
  type WindowsTaskContext,
  type WindowsTaskStartMode,
} from "./nativeServices/windowsTaskScheduler.js";
import {
  uninstallOneShotJobArguments,
  uninstallOneShotJobLabel,
  uninstallPlacement,
  uninstallTransientUnitArgs,
  uninstallTransientUnitName,
  type UninstallHandOffCommand,
  type UninstallPlacement,
} from "./nativeServices/uninstallPlacement.js";

const PI_WEB_PACKAGE_NAME = "@gang-of-beads/pi-web";

const systemdServiceDir = join(homedir(), ".config", "systemd", "user");
const launchdServiceDir = join(homedir(), "Library", "LaunchAgents");
const termuxBootScript = termuxBootScriptPath(homedir());
const windowsLauncherDir = windowsLauncherDirectory(process.env, homedir());
const logDir = join(defaultPiWebDataDir(), "logs");

type InstallMode = "production" | "dev";
type ServiceId = NativeServiceId;
type ServiceBackend = NativeServiceBackend;
type Check = [string, string[]];

interface InstallOptions {
  host: string;
  port: string;
  mode: InstallMode;
  config?: string;
  windowsStartMode?: WindowsTaskStartMode;
}

interface ServiceRef extends NativeServiceManagerRef {
  id: ServiceId;
}

type ServiceHealth = "running" | "stopped" | "not-installed" | "unknown";

interface ServiceRuntimeStatus {
  ref: ServiceRef;
  health: ServiceHealth;
  detail: string;
  target: string;
  filePath: string;
  pid?: string;
}

const serviceRefs: Record<ServiceId, ServiceRef> = {
  sessiond: { id: "sessiond", ...nativeServiceManagerRefs.sessiond },
  web: { id: "web", ...nativeServiceManagerRefs.web },
  uiDev: { id: "uiDev", ...nativeServiceManagerRefs.uiDev },
};

const productionServiceIds: ServiceId[] = [...productionNativeServiceIds];

function platformLabel(): string {
  if (process.platform === "darwin") return "macOS";
  if (process.platform === "linux") return "Linux";
  if (process.platform === "win32") return "Windows";
  if (process.platform === "android") return "Android";
  return process.platform;
}

const serviceBackends: Readonly<Record<NativeServiceBackendKind, ServiceBackend>> = {
  systemd: { kind: "systemd", label: "systemd user services" },
  launchd: { kind: "launchd", label: "LaunchAgents" },
  termux: { kind: "termux", label: "termux-services" },
  windows: { kind: "windows", label: "Windows scheduled tasks" },
};

export function serviceBackendForPlatform(
  platform: NodeJS.Platform,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  isSystemdBooted: () => boolean = systemdBooted,
): ServiceBackend | undefined {
  const kind = nativeServiceBackendKind(platform, environment, isSystemdBooted);
  return kind === undefined ? undefined : serviceBackends[kind];
}

function currentServiceBackend(): ServiceBackend | undefined {
  return serviceBackendForPlatform(process.platform);
}

function requireServiceBackend(command: string): ServiceBackend {
  const backend = currentServiceBackend();
  if (backend !== undefined) return backend;
  throw new Error(`\`${command}\` requires a supported per-user service manager (systemd user services, LaunchAgents or termux-services) and is not supported on ${noServiceManagerHost()}.\n\n${currentManualRunAdvice()}`);
}

/** Linux has a service manager only when systemd runs; a container or WSL without systemd has none. */
function noServiceManagerHost(): string {
  return process.platform === "linux" ? "Linux without a running systemd (a container, or WSL without systemd)" : platformLabel();
}

type ManualRunInstallation = "checkout" | "installed";
type ManualRunShell = "posix" | "powershell";

interface ManualRunCommands {
  readonly foreground: readonly string[];
  readonly heading: string;
  readonly sessiond: string;
  readonly web: string;
  readonly development: readonly string[];
}

const manualRunCommands: Record<ManualRunInstallation, ManualRunCommands> = {
  checkout: {
    foreground: [
      "Run PI WEB in the foreground from a built checkout, both processes in one command:",
      "  pnpm run build && node dist/cli.js run",
      "",
    ],
    heading: "Or run each process yourself from a checkout, in two terminals:",
    sessiond: "pnpm run start:sessiond",
    web: "pnpm start",
    development: [
      "",
      "For development in one terminal:",
      "  pnpm run dev",
      "",
      "For split development, keep sessiond separate and run web/API plus Vite UI separately:",
      "  pnpm run dev:sessiond",
      "  pnpm run dev:web",
      "  pnpm run dev:client",
    ],
  },
  installed: {
    foreground: [
      "Run PI WEB in the foreground, both processes in one command (a container's entrypoint):",
      "  pi-web run",
      "",
    ],
    heading: "Or run each process yourself, in two terminals:",
    sessiond: "pi-web-sessiond",
    web: "pi-web-server",
    development: [],
  },
};

const manualRunWebCommand: Record<ManualRunShell, (web: string) => string[]> = {
  posix: (web) => [`  PI_WEB_PORT=8504 ${web}`],
  powershell: (web) => ['  $env:PI_WEB_PORT = "8504"', `  ${web}`],
};

/**
 * How to run PI WEB without a service manager. Outside Windows every
 * installation first offers the one-command foreground run: `pi-web run` for an
 * npm install, `node dist/cli.js run` for a checkout. Then the two processes by
 * hand: a checkout runs its package scripts, an npm install, which has no
 * scripts, its installed commands. Windows shells are PowerShell, which sets a
 * variable with `$env:`.
 */
export function manualRunAdvice(installation: ManualRunInstallation, platform: NodeJS.Platform): string {
  const commands = manualRunCommands[installation];
  return [
    ...(platform === "win32" ? [] : commands.foreground),
    commands.heading,
    `  ${commands.sessiond}`,
    ...manualRunWebCommand[platform === "win32" ? "powershell" : "posix"](commands.web),
    ...commands.development,
  ].join("\n");
}

/** A checkout carries its TypeScript sources; the published package ships only `dist`. */
function currentManualRunAdvice(): string {
  return manualRunAdvice(existsSync(join(packageRootPath(), "src", "cli.ts")) ? "checkout" : "installed", process.platform);
}

function run(command: string, args: string[], options: { check?: boolean } = {}): number {
  const result = spawnSync(command, args, { stdio: "inherit" });
  const status = result.status ?? 1;
  if (options.check === true && status !== 0) process.exit(status);
  return status;
}

function outputText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function capture(command: string, args: string[], options: { timeoutMs?: number } = {}): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: options.timeoutMs });
  const errorMessage = result.error instanceof Error ? result.error.message : "";
  const stderr = outputText(result.stderr);
  return { status: result.status ?? 1, stdout: outputText(result.stdout), stderr: stderr === "" ? errorMessage : stderr };
}

function captureInstalledServiceDefinitionCommand(
  command: string,
  args: string[],
): InstalledNativeServiceDefinitionCommandResult {
  const result = spawnSync(command, args);
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
    spawnError: result.error instanceof Error ? result.error.message : "",
  };
}

function runQuiet(command: string, args: string[]): number {
  return capture(command, args).status;
}

function hasCommand(command: string): boolean {
  return capture("/usr/bin/env", ["sh", "-c", `command -v ${shellSingleQuote(command)}`]).status === 0;
}

function isLingerEnabled(): boolean | undefined {
  if (!hasCommand("loginctl")) return undefined;
  const result = capture("loginctl", ["show-user", userInfo().username, "-p", "Linger"]);
  if (result.status !== 0) return undefined;
  const value = result.stdout.trim();
  if (value === "Linger=yes") return true;
  if (value === "Linger=no") return false;
  return undefined;
}

function parseInstallOptions(args: string[]): InstallOptions {
  const options: InstallOptions = { host: "127.0.0.1", port: "8504", mode: "production" };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--host") {
      const value = args[i + 1];
      if (value === undefined) throw new Error("--host requires a value");
      options.host = value;
      i += 1;
    } else if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
    } else if (arg === "--port") {
      const value = args[i + 1];
      if (value === undefined) throw new Error("--port requires a value");
      options.port = value;
      i += 1;
    } else if (arg.startsWith("--port=")) {
      options.port = arg.slice("--port=".length);
    } else if (arg === "--config") {
      const value = args[i + 1];
      if (value === undefined) throw new Error("--config requires a value");
      options.config = value;
      i += 1;
    } else if (arg.startsWith("--config=")) {
      options.config = arg.slice("--config=".length);
    } else if (arg === "--dev") {
      options.mode = "dev";
    } else if (arg === "--at-boot" || arg === "--at-log-on") {
      const startMode = arg === "--at-boot" ? "at-boot" : "log-on";
      if (options.windowsStartMode !== undefined && options.windowsStartMode !== startMode) throw new Error("--at-boot and --at-log-on cannot be combined");
      options.windowsStartMode = startMode;
    } else if (arg === "--user-systemd") {
      // Accepted for backwards-compatible readability; PI WEB chooses the native user service backend automatically.
    } else {
      throw new Error(`Unknown install option: ${arg}`);
    }
  }
  return options;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function fishSingleQuote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function packageRootPath(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function packageEntrypointPath(name: "server" | "sessiond"): string {
  return join(packageRootPath(), "dist", "server", name === "server" ? "index.js" : "sessiond.js");
}

export function regularFileExists(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function detectServiceShell(): NativeServiceShell {
  if (currentServiceBackend()?.kind === "windows") return windowsTaskServiceShell;
  const userShell = userInfo().shell ?? undefined;
  const envShell = process.env["SHELL"]?.trim();
  const detected = envShell === undefined || envShell === "" ? userShell : envShell;
  const name = basename(detected ?? "").replace(/^-/, "");
  if (name === "bash" || name === "zsh" || name === "fish") {
    return {
      name,
      executable: detected ?? name,
      source: "detected",
      detectedExecutable: detected ?? name,
    };
  }
  return {
    name: "bash",
    executable: "bash",
    source: "fallback",
    detectedExecutable: detected ?? null,
  };
}

function serviceShellCommand(command: string, cwd?: string): string[] {
  const fullCommand = cwd === undefined ? command : `cd ${serviceShellQuote(cwd)} && ${command}`;
  return ["/usr/bin/env", detectServiceShell().executable, "-lc", fullCommand];
}

function serviceShellQuote(value: string): string {
  return detectServiceShell().name === "fish" ? fishSingleQuote(value) : shellSingleQuote(value);
}

function describeServiceShell(): string {
  const shell = detectServiceShell();
  if (shell.name === "cmd") return "cmd.exe started by each task's launcher (PATH from the Windows user and system environment variables)";
  if (shell.source === "fallback") {
    return shell.detectedExecutable === null
      ? "could not detect a supported login shell; using bash"
      : `detected ${shell.detectedExecutable}; using bash because PI WEB currently supports bash, zsh, and fish`;
  }
  return shell.detectedExecutable === null ? shell.name : `${shell.name} (${shell.detectedExecutable})`;
}

/**
 * The environment a managed service is installed with: the config path when
 * one was chosen, the log directory launchd is pointed at (so the process trims
 * the file it is actually given; systemd sends the output to the journal and
 * the variable names nothing there), plus the deployment variables only the
 * installing environment knows. A service manager does not inherit the installing
 * shell's environment, so anything left out here is lost at service start.
 */
function serviceEnvironment(options: InstallOptions, configPath: string): Record<string, string> {
  return {
    ...deploymentServiceEnvironment(process.env),
    PI_WEB_LOG_DIR: logDir,
    ...(options.config === undefined ? {} : { PI_WEB_CONFIG: configPath }),
  };
}

function serviceRefList(ids: ServiceId[]): ServiceRef[] {
  return ids.map((id) => serviceRefs[id]);
}

function allServiceRefs(): ServiceRef[] {
  return serviceRefList(["sessiond", "web", "uiDev"]);
}

function productionServiceRefs(): ServiceRef[] {
  return serviceRefList(productionServiceIds);
}

function startOrder(refs: ServiceRef[]): ServiceRef[] {
  return orderServices(refs, serviceStartOrder);
}

function stopOrder(refs: ServiceRef[]): ServiceRef[] {
  return orderServices(refs, serviceStopOrder);
}

function devRootPath(): string {
  return resolve(process.cwd());
}

function validateDevCheckout(root: string): void {
  const packageJsonPath = join(root, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(`Development mode must be installed from a PI WEB checkout. Missing package.json: ${packageJsonPath}`);
  }

  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (!isRecord(parsed) || parsed["name"] !== PI_WEB_PACKAGE_NAME) {
    throw new Error(`Development mode must be installed from a PI WEB checkout. ${packageJsonPath} is not ${PI_WEB_PACKAGE_NAME}.`);
  }
}

function launchdLogPath(ref: ServiceRef): string {
  return join(logDir, ref.logName);
}

function installConfigPath(options: InstallOptions): string {
  return options.config === undefined ? defaultPiWebConfigPath() : resolve(options.config);
}

async function writeInitialConfig(options: InstallOptions, configPath: string): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  if (!existsSync(configPath)) {
    await writeFile(configPath, examplePiWebConfig({ host: options.host, port: Number(options.port) }), { mode: 0o600 });
  }
}

function systemdServicePath(ref: ServiceRef): string {
  return join(systemdServiceDir, ref.systemdName);
}

function launchdPlistPath(ref: ServiceRef): string {
  return join(launchdServiceDir, ref.launchdPlistName);
}

function windowsLauncherPath(ref: NativeServiceManagerRef): string {
  return join(windowsLauncherDir, ref.windowsLauncherName);
}

function windowsTaskName(ref: NativeServiceManagerRef): string {
  return windowsUserTaskName(ref.windowsTaskName, userInfo().username);
}

const serviceFilePaths: Readonly<Record<NativeServiceBackendKind, (ref: ServiceRef) => string>> = {
  systemd: systemdServicePath,
  launchd: launchdPlistPath,
  termux: termuxRunScriptPath,
  windows: windowsLauncherPath,
};

function serviceFilePath(backend: ServiceBackend, ref: ServiceRef): string {
  return serviceFilePaths[backend.kind](ref);
}

function serviceFileExists(backend: ServiceBackend, ref: ServiceRef): boolean {
  return existsSync(serviceFilePath(backend, ref));
}

function installedServiceIds(backend: ServiceBackend): Set<ServiceId> {
  return new Set(allServiceRefs().filter((ref) => serviceFileExists(backend, ref)).map((ref) => ref.id));
}

function installedServiceRefs(backend: ServiceBackend): ServiceRef[] {
  const installed = startOrder(allServiceRefs().filter((ref) => serviceFileExists(backend, ref)));
  return installed.length === 0 ? productionServiceRefs() : installed;
}

/**
 * Write and (re)start the systemd units. The unit this command runs inside is started, never
 * restarted or stopped: restarting it kills the command and the session that ran it (see
 * `reloadLaunchdServicesForInstall`). Starting a running unit does nothing, so it keeps the
 * previous build until it is restarted from outside.
 */
async function installSystemdServices(plan: NativeServicePlan): Promise<void> {
  const hosting = hostingServiceId(process.env);
  const selected = new Set<ServiceId>(plan.services.map((service) => service.id));
  const obsolete = stopOrder(allServiceRefs().filter((ref) => !selected.has(ref.id)));

  for (const ref of obsolete) {
    runQuiet("systemctl", ["--user", "disable", ...(restartsInPlace(ref.id, hosting) ? [] : ["--now"]), ref.systemdName]);
    await rm(systemdServicePath(ref), { force: true });
  }

  await mkdir(systemdServiceDir, { recursive: true });
  for (const service of plan.services) {
    await writeFile(join(systemdServiceDir, service.manager.systemdName), renderSystemdUnit(plan, service));
  }

  const names = plan.services.map((service) => service.manager.systemdName);
  const hosted = plan.services.filter((service) => restartsInPlace(service.id, hosting)).map((service) => service.manager.systemdName);
  const restartable = names.filter((name) => !hosted.includes(name));
  run("systemctl", ["--user", "daemon-reload"], { check: true });
  run("systemctl", ["--user", "enable", ...names], { check: true });
  if (restartable.length > 0) run("systemctl", ["--user", "restart", ...restartable], { check: true });
  if (hosted.length > 0) {
    run("systemctl", ["--user", "start", ...hosted], { check: true });
    console.log(keptPreviousBuildNotice(hosted));
  }
}

function keptPreviousBuildNotice(names: readonly string[]): string {
  return `${names.join(", ")} runs this command, so it keeps the previous build; run \`pi-web restart\` from a terminal outside PI WEB to move it.`;
}

function launchdDomain(): string {
  return `gui/${String(userInfo().uid)}`;
}

function currentLaunchdServiceTarget(ref: ServiceRef): string {
  return launchdServiceTarget(launchdDomain(), ref);
}

function launchdActionContext(): LaunchdServiceContext {
  return { domain: launchdDomain(), plistPath: launchdPlistPath, hostingServiceId: hostingServiceId(process.env) };
}

function serviceActionDeps(
  backend: ServiceBackend,
  probeEnvironment: NodeJS.ProcessEnv = process.env,
): ServiceActionDeps {
  return {
    run: (command, args) => run(command, args),
    runQuiet,
    sleep: (ms) => new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
    isServiceRunning: (ref) => runtimeStatus(backend, ref).health === "running",
    isComponentReady: (component) => probeRunningComponentReady(component, { configEnv: probeEnvironment }),
  };
}

async function installLaunchdServices(plan: NativeServicePlan): Promise<void> {
  const selected = new Set<ServiceId>(plan.services.map((service) => service.id));

  await mkdir(launchdServiceDir, { recursive: true });
  await mkdir(logDir, { recursive: true });

  const kept = await reloadLaunchdServicesForInstall(
    { unload: stopOrder(allServiceRefs()), load: plan.services.map((service) => serviceRefFromPlan(service.id, service.manager)) },
    launchdActionContext(),
    serviceActionDeps(plan.backend),
    async () => {
      for (const ref of allServiceRefs().filter((candidate) => !selected.has(candidate.id))) {
        await rm(launchdPlistPath(ref), { force: true });
      }
      for (const service of plan.services) {
        await writeFile(join(launchdServiceDir, service.manager.launchdPlistName), renderLaunchdPlist(plan, service, logDir));
      }
    },
  );
  if (kept.length > 0) console.log(keptPreviousBuildNotice(kept.map((ref) => ref.launchdLabel)));
}

async function installTermuxNativeServices(plan: NativeServicePlan): Promise<void> {
  const kept = await installTermuxServices(
    plan,
    { allRefs: allServiceRefs(), logDirectory: logDir, bootScriptPath: termuxBootScript, hostingServiceId: hostingServiceId(process.env) },
    serviceActionDeps(plan.backend),
  );
  if (kept.length > 0) console.log(keptPreviousBuildNotice(kept.map(termuxServiceDirectory)));
}

function runWindowsTaskScript(script: string): void {
  run(windowsPowerShell, windowsPowerShellArguments(script), { check: true });
}

function currentWindowsUserSid(): string {
  const result = capture("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
  const sid = result.status === 0 ? windowsUserSidFromWhoami(result.stdout) : undefined;
  if (sid === undefined) throw new Error(`Could not read the current user's SID from \`whoami /user\`: ${firstOutputLine(result.stderr, result.stdout) ?? `exit status ${String(result.status)}`}`);
  return sid;
}

function windowsLauncherRefs(refs: readonly NativeServiceManagerRef[]): { name: string; launcherPath: string }[] {
  return refs.map((ref) => ({ name: windowsTaskName(ref), launcherPath: windowsLauncherPath(ref) }));
}

/**
 * Stop the tasks, rewrite their launchers, register them again and start them. The task this
 * command runs inside is re-registered and started but never stopped: stopping it would kill the
 * command (see `reloadLaunchdServicesForInstall`). A running launcher has already read its file, so
 * that task keeps the previous build until it is restarted from outside.
 */
async function installWindowsTaskServices(plan: NativeServicePlan, startMode: WindowsTaskStartMode): Promise<void> {
  const hosting = hostingServiceId(process.env);
  const userSid = currentWindowsUserSid();
  const selected = new Set<ServiceId>(plan.services.map((service) => service.id));
  const obsolete = stopOrder(allServiceRefs().filter((ref) => !selected.has(ref.id)));
  const planRefs = plan.services.map((service) => serviceRefFromPlan(service.id, service.manager));
  const hosted = planRefs.filter((ref) => restartsInPlace(ref.id, hosting));

  if (obsolete.length > 0) runWindowsTaskScript(windowsTaskUnregisterScript(windowsLauncherRefs(obsolete)));
  for (const ref of obsolete) await rm(windowsLauncherPath(ref), { force: true });
  const stoppable = stopOrder(planRefs.filter((ref) => !hosted.includes(ref)));
  if (stoppable.length > 0) runWindowsTaskScript(windowsTaskStopScript(windowsLauncherRefs(stoppable)));

  await mkdir(windowsLauncherDir, { recursive: true });
  await mkdir(logDir, { recursive: true });
  for (const service of plan.services) {
    await writeFile(windowsLauncherPath(service.manager), renderWindowsTaskLauncher(plan, service, join(logDir, service.manager.logName), windowsTaskName(service.manager), startMode));
  }
  runWindowsTaskScript(windowsTaskRegisterScript(plan.services.map((service) => ({
    name: windowsTaskName(service.manager),
    xml: renderWindowsTaskXml(windowsServiceTaskDefinition(plan, service, windowsLauncherPath(service.manager), userSid, startMode)),
  }))));
  windowsHandOffTaskInstallers[startMode](userSid);
  runWindowsTaskScript(windowsTaskStartScript(startOrder(planRefs).map(windowsTaskName)));
  if (hosted.length > 0) console.log(keptPreviousBuildNotice(hosted.map(windowsTaskName)));
}

/**
 * The hand-off tasks a mode's install leaves registered: at-boot mode registers them, for a hand-off
 * to start (windowsCliHandOffScript); log-on mode registers its own as needed, so its install
 * removes the idle ones, an at-boot mode install's among them. That removal is tidying, so a
 * failure only warns: the services are registered by then and still have to be started.
 */
const windowsHandOffTaskInstallers: Readonly<Record<WindowsTaskStartMode, (userSid: string) => void>> = {
  "log-on": () => {
    const names = windowsCliHandOffTaskNames(userInfo().username);
    const result = capture(windowsPowerShell, windowsPowerShellArguments(windowsIdleTaskUnregisterScript(names)));
    if (result.status === 0) return;
    console.log(`! Could not remove the idle scheduled tasks ${names.map((name) => `"${name}"`).join(" and ")}: ${firstOutputLine(result.stderr, result.stdout) ?? `exit status ${String(result.status)}`}. The install continues; \`pi-web uninstall\` removes them.`);
  },
  "at-boot": (userSid) => {
    runWindowsTaskScript(windowsCliHandOffRegisterScript(windowsCliHandOffVerbs.map((verb) => ({
      verb,
      cliPath: fileURLToPath(import.meta.url),
      userName: userInfo().username,
      userSid,
      logPath: join(logDir, `${verb}.log`),
    }))));
  },
};

/** The second argument is the Windows tasks' start mode; the other service managers ignore it. */
const nativeServiceInstallers: Readonly<Record<NativeServiceBackendKind, (plan: NativeServicePlan, windowsStartMode: WindowsTaskStartMode) => Promise<void>>> = {
  systemd: installSystemdServices,
  launchd: installLaunchdServices,
  termux: installTermuxNativeServices,
  windows: installWindowsTaskServices,
};

async function installNativeServices(plan: NativeServicePlan, windowsStartMode: WindowsTaskStartMode): Promise<void> {
  await nativeServiceInstallers[plan.backend.kind](plan, windowsStartMode);
}

function serviceRefFromPlan(id: ServiceId, manager: NativeServiceManagerRef): ServiceRef {
  return { id, ...manager };
}

async function uninstallSystemdServices(): Promise<void> {
  for (const ref of stopOrder(allServiceRefs())) {
    runQuiet("systemctl", ["--user", "disable", "--now", ref.systemdName]);
    await rm(systemdServicePath(ref), { force: true });
  }
  runQuiet("systemctl", ["--user", "daemon-reload"]);
}

async function uninstallLaunchdServices(): Promise<void> {
  for (const ref of stopOrder(allServiceRefs())) {
    runQuiet("launchctl", launchdBootoutArgs(currentLaunchdServiceTarget(ref)));
    await rm(launchdPlistPath(ref), { force: true });
  }
}

async function uninstallWindowsTaskServices(): Promise<void> {
  const refs = stopOrder(allServiceRefs());
  runWindowsTaskScript([
    windowsTaskUnregisterScript(windowsLauncherRefs(refs)),
    windowsIdleTaskUnregisterScript(windowsCliHandOffTaskNames(userInfo().username)),
  ].join("\n"));
  for (const ref of refs) await rm(windowsLauncherPath(ref), { force: true });
  await removeEmptyDirectory(windowsLauncherDir);
  await removeEmptyDirectory(dirname(windowsLauncherDir));
}

async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTEMPTY"))) throw error;
  }
}

const nativeServiceUninstallers: Readonly<Record<NativeServiceBackendKind, (backend: ServiceBackend) => Promise<void>>> = {
  systemd: uninstallSystemdServices,
  launchd: uninstallLaunchdServices,
  termux: (backend) => uninstallTermuxServices(allServiceRefs(), termuxBootScript, serviceActionDeps(backend)),
  windows: uninstallWindowsTaskServices,
};

async function uninstallNativeServices(backend: ServiceBackend): Promise<void> {
  await nativeServiceUninstallers[backend.kind](backend);
}

function serviceDisplayName(ref: ServiceRef): string {
  if (ref.id === "sessiond") return "session daemon";
  if (ref.id === "uiDev") return "UI/API dev server";
  return "web server";
}

function statusServiceRefs(backend: ServiceBackend): ServiceRef[] {
  const ids = installedServiceIds(backend);
  if (ids.size === 0) return [];
  if (ids.has("web") && ids.has("uiDev")) return startOrder(allServiceRefs());
  if (ids.has("uiDev")) return serviceRefList(["sessiond", "uiDev"]);
  if (ids.has("web")) return productionServiceRefs();
  return serviceRefList(["sessiond"]);
}

function serviceInstallMode(backend: ServiceBackend): string {
  const ids = installedServiceIds(backend);
  if (ids.size === 0) return "not installed";
  const hasSessiond = ids.has("sessiond");
  const hasWeb = ids.has("web");
  const hasUiDev = ids.has("uiDev");
  if (hasWeb && hasUiDev) return "mixed";
  if (hasUiDev) return hasSessiond ? "development" : "development (incomplete)";
  if (hasWeb) return hasSessiond ? "production" : "production (incomplete)";
  return "partial";
}

function makeServiceRuntimeStatus(ref: ServiceRef, health: ServiceHealth, detail: string, target: string, filePath: string, pid?: string): ServiceRuntimeStatus {
  return {
    ref,
    health,
    detail,
    target,
    filePath,
    ...(pid === undefined ? {} : { pid }),
  };
}

function firstOutputLine(...values: string[]): string | undefined {
  for (const value of values) {
    const line = value.trim().split("\n").find((candidate) => candidate.trim() !== "");
    if (line !== undefined) return line.trim();
  }
  return undefined;
}

function systemdMainPid(ref: ServiceRef): string | undefined {
  const result = capture("systemctl", ["--user", "--no-pager", "show", ref.systemdName, "--property=MainPID", "--value"]);
  if (result.status !== 0) return undefined;
  const value = result.stdout.trim();
  return value === "" || value === "0" ? undefined : value;
}

function systemdRuntimeStatus(backend: ServiceBackend, ref: ServiceRef): ServiceRuntimeStatus {
  const target = ref.systemdName;
  const filePath = serviceFilePath(backend, ref);
  if (!serviceFileExists(backend, ref)) return makeServiceRuntimeStatus(ref, "not-installed", "not installed", target, filePath);

  const result = capture("systemctl", ["--user", "--no-pager", "is-active", target]);
  const state = firstOutputLine(result.stdout, result.stderr) ?? "unknown";
  if (result.status === 0 && state === "active") return makeServiceRuntimeStatus(ref, "running", "running", target, filePath, systemdMainPid(ref));
  return makeServiceRuntimeStatus(ref, state === "unknown" ? "unknown" : "stopped", state, target, filePath);
}

function parseLaunchdField(output: string, field: string): string | undefined {
  const match = new RegExp(`^\\s*${field}\\s=\\s(.+)$`, "m").exec(output);
  return match?.[1]?.trim();
}

export function launchdRuntimeDetails(output: string): { state: string; detail: string; pid: string | undefined } {
  const state = parseLaunchdField(output, "state") ?? "unknown";
  const pid = parseLaunchdField(output, "pid");
  const lastExitCode = parseLaunchdField(output, "last exit code");
  const detail = state === "running"
    ? "running"
    : lastExitCode === undefined ? state : `${state} (last exit code ${lastExitCode})`;
  return { state, detail, pid };
}

function launchdRuntimeStatus(backend: ServiceBackend, ref: ServiceRef): ServiceRuntimeStatus {
  const target = currentLaunchdServiceTarget(ref);
  const filePath = serviceFilePath(backend, ref);
  if (!serviceFileExists(backend, ref)) return makeServiceRuntimeStatus(ref, "not-installed", "not installed", target, filePath);

  const result = capture("launchctl", ["print", target]);
  if (result.status !== 0) {
    return makeServiceRuntimeStatus(ref, "stopped", firstOutputLine(result.stderr, result.stdout) ?? "not loaded", target, filePath);
  }

  const details = launchdRuntimeDetails(result.stdout);
  const health: ServiceHealth = details.state === "running" ? "running" : details.state === "unknown" ? "unknown" : "stopped";
  return makeServiceRuntimeStatus(ref, health, details.detail, target, filePath, details.pid);
}

/** The name a service manager knows a service by, as printed in status and failures. */
const serviceManagerTargets: Readonly<Record<NativeServiceBackendKind, (ref: ServiceRef) => string>> = {
  systemd: (ref) => ref.systemdName,
  launchd: currentLaunchdServiceTarget,
  termux: termuxServiceDirectory,
  windows: windowsTaskName,
};

const termuxServiceHealth: Readonly<Record<TermuxServiceState, ServiceHealth>> = {
  running: "running",
  down: "stopped",
  unsupervised: "unknown",
  unrecognized: "unknown",
};

function termuxRuntimeStatus(backend: ServiceBackend, ref: ServiceRef): ServiceRuntimeStatus {
  const target = termuxServiceDirectory(ref);
  const filePath = serviceFilePath(backend, ref);
  if (!serviceFileExists(backend, ref)) return makeServiceRuntimeStatus(ref, "not-installed", "not installed", target, filePath);

  const status = termuxServiceStatus(capture("sv", ["status", target]));
  return makeServiceRuntimeStatus(ref, termuxServiceHealth[status.state], status.detail, target, filePath, status.pid);
}

function windowsRuntimeStatus(backend: ServiceBackend, ref: ServiceRef): ServiceRuntimeStatus {
  const target = windowsTaskName(ref);
  const filePath = serviceFilePath(backend, ref);
  if (!serviceFileExists(backend, ref)) return makeServiceRuntimeStatus(ref, "not-installed", "not installed", target, filePath);

  const result = capture(windowsPowerShell, windowsPowerShellArguments(windowsTaskQueryScript([target])));
  if (result.status !== 0) {
    return makeServiceRuntimeStatus(ref, "unknown", `Task Scheduler query failed: ${firstOutputLine(result.stderr, result.stdout) ?? `exit status ${String(result.status)}`}`, target, filePath);
  }
  const status = parseWindowsTaskQuery(result.stdout, target);
  return makeServiceRuntimeStatus(ref, windowsTaskHealth[status.state], windowsTaskDetail(status), target, filePath);
}

const runtimeStatusReaders: Readonly<Record<NativeServiceBackendKind, (backend: ServiceBackend, ref: ServiceRef) => ServiceRuntimeStatus>> = {
  systemd: systemdRuntimeStatus,
  launchd: launchdRuntimeStatus,
  termux: termuxRuntimeStatus,
  windows: windowsRuntimeStatus,
};

function runtimeStatus(backend: ServiceBackend, ref: ServiceRef): ServiceRuntimeStatus {
  return runtimeStatusReaders[backend.kind](backend, ref);
}

function printServiceStatus(status: ServiceRuntimeStatus): void {
  const icon = status.health === "running" ? "✓" : "✗";
  const pid = status.pid === undefined ? "" : `, pid ${status.pid}`;
  console.log(`${icon} ${serviceDisplayName(status.ref)}: ${status.detail} (${status.target}${pid})`);
  if (status.health === "not-installed") console.log(`  missing service file: ${status.filePath}`);
}

function printServiceStatusReport(backend: ServiceBackend): boolean {
  const refs = statusServiceRefs(backend);
  console.log(`PI WEB services: ${serviceInstallMode(backend)} (${backend.label})`);
  if (refs.length === 0) {
    console.log("✗ no PI WEB service files found");
    console.log("  Run `pi-web install` or `pi-web install --dev`.");
    return false;
  }
  if (backend.kind === "windows") console.log(windowsStartModeLines[installedWindowsStartMode()]);

  const statuses = refs.map((ref) => runtimeStatus(backend, ref));
  for (const status of statuses) printServiceStatus(status);
  console.log("\nUse `pi-web logs` for service logs.");
  return statuses.every((status) => status.health === "running");
}

function configuredServiceCommand(name: "PI_WEB_SERVER_EXEC" | "PI_WEB_SESSIOND_EXEC"): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}

function productionNativeServicePlanInput(
  backend: ServiceBackend,
  shell: NativeServiceShell,
  environment: Readonly<Record<string, string>>,
): ProductionNativeServicePlanInput {
  return {
    backend,
    shell,
    environment,
    executables: {
      sessiond: {
        configuredCommand: configuredServiceCommand("PI_WEB_SESSIOND_EXEC"),
        namedCommand: "pi-web-sessiond",
        bundledEntrypointPath: packageEntrypointPath("sessiond"),
      },
      web: {
        configuredCommand: configuredServiceCommand("PI_WEB_SERVER_EXEC"),
        namedCommand: "pi-web-server",
        bundledEntrypointPath: packageEntrypointPath("server"),
      },
    },
  };
}

function nativeServiceInstallCandidate(
  options: InstallOptions,
  backend: ServiceBackend,
  configPath: string,
  devRoot: string | undefined,
): NativeServiceInstallCandidate {
  const shell = detectServiceShell();
  const environment = serviceEnvironment(options, configPath);
  if (options.mode === "production") {
    return {
      mode: "production",
      input: productionNativeServicePlanInput(backend, shell, environment),
    };
  }

  const root = devRoot ?? devRootPath();
  return {
    mode: "development",
    input: {
      backend,
      shell,
      environment,
      workingDirectory: root,
      packageJsonPath: join(root, "package.json"),
    },
  };
}

function printNativeServiceInstallFailure(failure: NativeServiceInstallFailure): void {
  if (failure.kind === "plan-resolution") {
    for (const item of failure.failures) {
      if (item.kind === "probe-infrastructure") {
        console.log(`✗ Service-manager probe infrastructure failure (${item.reason}): ${item.message}`);
      } else if (item.kind === "entrypoint-inspection-failure") {
        console.log(`✗ Could not inspect bundled ${item.serviceId} entrypoint ${item.entrypointPath}: ${item.message}`);
      } else {
        console.log(`✗ ${item.namedCommand} is unavailable to the service manager, and bundled entrypoint ${item.bundledEntrypointPath} is missing.`);
        if (item.namedCommandFailure !== null) console.log(`  ${item.namedCommandFailure}`);
      }
    }
    return;
  }

  for (const item of failure.failures) {
    if (item.kind === "probe-infrastructure") {
      console.log(`✗ Service-manager probe infrastructure failure (${item.reason}): ${item.message}`);
    } else {
      console.log(`✗ ${item.prerequisite.description}`);
      if (item.detail !== null && item.detail !== item.prerequisite.description) console.log(`  ${item.detail}`);
    }
  }
}

const windowsStartModeOptions: Readonly<Record<WindowsTaskStartMode, string>> = {
  "log-on": "--at-log-on",
  "at-boot": "--at-boot",
};

/** `--at-boot` and `--at-log-on` choose when Windows tasks start; the other service managers have their own way, or none. */
const windowsStartModeOptionRefusals: Readonly<Record<NativeServiceBackendKind, ((option: string) => string) | undefined>> = {
  systemd: (option) => `\`${option}\` is a Windows option. On Linux the user services start at boot and keep running without a login once lingering is on: \`sudo loginctl enable-linger ${userInfo().username}\`.`,
  launchd: (option) => `\`${option}\` is a Windows option and does not apply to macOS, where LaunchAgents start when you log in.`,
  termux: (option) => `\`${option}\` is a Windows option and does not apply to Termux, where the Termux:Boot app starts the services when the phone starts.`,
  windows: undefined,
};

function installedWindowsStartMode(): InstalledWindowsTaskStartMode {
  return readInstalledWindowsTaskStartMode(windowsLauncherPath(serviceRefs.sessiond));
}

/**
 * The start mode a Windows install registers (see windowsInstallStartMode). On the other service
 * managers a start-mode option is refused and the returned mode is not used.
 */
function installWindowsStartMode(backend: ServiceBackend, requested: WindowsTaskStartMode | undefined): WindowsTaskStartMode {
  const refusal = windowsStartModeOptionRefusals[backend.kind];
  if (requested !== undefined && refusal !== undefined) throw new Error(refusal(windowsStartModeOptions[requested]));
  if (backend.kind !== "windows") return "log-on";
  const startMode = windowsInstallStartMode(requested, installedWindowsStartMode());
  if (startMode !== undefined) return startMode;
  throw new Error(`The installed launcher ${windowsLauncherPath(serviceRefs.sessiond)} does not record a start mode PI WEB can read. ${windowsStartModeRepair()}`);
}

/** How to record the start mode again when the installed launcher's mode cannot be read; a standard account cannot open PowerShell as itself elevated. */
function windowsStartModeRepair(): string {
  return `To record the start mode again, run \`pi-web install --at-log-on\` from PowerShell opened as administrator to start PI WEB when you sign in, or \`pi-web install --at-boot\` there on an administrator account to start it at boot. On an account that is not an administrator, delete ${windowsLauncherPath(serviceRefs.sessiond)} and run \`pi-web install --at-log-on\`.`;
}

/** The install command the user ran, with the start-mode option they passed. */
function windowsInstallCommand(requested: WindowsTaskStartMode | undefined): string {
  return requested === undefined ? "pi-web install" : `pi-web install ${windowsStartModeOptions[requested]}`;
}

/**
 * Switching the start mode replaces the tasks a PI WEB terminal runs in, and the running session
 * daemon keeps its old logon and rights: tasks of the new mode then cannot manage it, and the next
 * daemon collides with it. So a switch runs only outside PI WEB.
 */
const windowsHostedStartModeSwitchRefusals: Readonly<Record<WindowsTaskStartMode, string>> = {
  "log-on": "Switching PI WEB to start when you sign in replaces the tasks this PI WEB terminal runs in, so it cannot run inside PI WEB: run `pi-web install --at-log-on` from PowerShell opened as administrator outside PI WEB.",
  "at-boot": "Switching PI WEB to start at boot replaces the tasks this PI WEB terminal runs in, so it cannot run inside PI WEB: run `pi-web install --at-boot` from PowerShell opened as administrator on an administrator account, outside PI WEB.",
};

function requireWindowsStartModeSwitchOutsidePiWeb(backend: ServiceBackend, startMode: WindowsTaskStartMode): void {
  if (backend.kind !== "windows" || hostingServiceId(process.env) === undefined) return;
  if (startMode === windowsTaskStartModeInUse[installedWindowsStartMode()]) return;
  throw new Error(windowsHostedStartModeSwitchRefusals[startMode]);
}

/** What this caller can tell about the context a start mode's tasks need; undefined when the check itself failed. */
function windowsTaskContext(startMode: WindowsTaskStartMode): WindowsTaskContext | undefined {
  const result = capture(windowsPowerShell, windowsPowerShellArguments(windowsTaskContextScript(startMode)), { timeoutMs: 10_000 });
  return result.status === 0 ? parseWindowsTaskContext(result.stdout) : undefined;
}

type WindowsTaskContextRefusal = Exclude<WindowsTaskContext, "ready">;

const windowsInstallContextRefusals: Readonly<Record<WindowsTaskContextRefusal, (userName: string, installCommand: string) => string>> = {
  "nobody-signed-in": (userName, installCommand) => `Nobody is signed in to Windows as ${userName}, and PI WEB's tasks run in your signed-in session. Sign in to Windows and run \`${installCommand}\` again, or install with \`pi-web install --at-boot\` from PowerShell opened as administrator on an administrator account to run PI WEB without signing in.`,
  "not-elevated": () => "Starting PI WEB at boot registers tasks that run whether or not anyone is signed in, and only an elevated token can: run `pi-web install --at-boot` from PowerShell opened as administrator on an administrator account. `pi-web install --at-log-on` starts PI WEB when you sign in instead, without administrator rights.",
};

const windowsDoctorContextNotices: Readonly<Record<WindowsTaskContextRefusal, (userName: string) => string>> = {
  "nobody-signed-in": (userName) => `! Not verified: nobody is signed in to Windows as ${userName}, and the tasks run in your signed-in session; sign in and run \`pi-web doctor\` again to check them.`,
  "not-elevated": () => "! Not verified: run `pi-web doctor` from PowerShell opened as administrator to check the at-boot tasks.",
};

type WindowsServiceManagementVerb = ServiceLifecycleAction | "uninstall" | "install";

const windowsAtBootElevationNotice = "PI WEB starts at boot here and runs with your full administrator rights, so only PowerShell opened as administrator can";

const windowsAtBootLifecycleRefusal = (verb: ServiceLifecycleAction) => (command: string): string => `${windowsAtBootElevationNotice} ${verb} it. Run \`${command}\` from PowerShell opened as administrator. To restart, you can also use the Updates page, or run \`pi-web restart\` in a PI WEB terminal.`;

const windowsAtBootServiceManagementRefusals: Readonly<Record<WindowsServiceManagementVerb, (command: string) => string>> = {
  stop: windowsAtBootLifecycleRefusal("stop"),
  start: windowsAtBootLifecycleRefusal("start"),
  restart: windowsAtBootLifecycleRefusal("restart"),
  uninstall: (command) => `${windowsAtBootElevationNotice} remove it. Run \`${command}\` from PowerShell opened as administrator, or in a PI WEB terminal.`,
  install: (command) => `${windowsAtBootElevationNotice} reinstall it. Run \`${command}\` from PowerShell opened as administrator.`,
};

const windowsServiceManagementObjects: Readonly<Record<WindowsServiceManagementVerb, string>> = {
  stop: "stop it",
  start: "start it",
  restart: "restart it",
  uninstall: "remove it",
  install: "reinstall it",
};

type WindowsServiceManagementRefusal = Exclude<WindowsServiceManagementAccess, "ok">;

const windowsServiceManagementRefusals: Readonly<Record<WindowsServiceManagementRefusal, (verb: WindowsServiceManagementVerb, command: string) => string>> = {
  "at-boot-elevation-required": (verb, command) => windowsAtBootServiceManagementRefusals[verb](command),
  "unreadable-elevation-required": (verb, command) => `PI WEB cannot read the start mode recorded in ${windowsLauncherPath(serviceRefs.sessiond)}, so it may start at boot with your full administrator rights, and only PowerShell opened as administrator can then ${windowsServiceManagementObjects[verb]}. Run \`${command}\` from PowerShell opened as administrator. ${windowsStartModeRepair()}`,
};

/**
 * Refuse, before anything changes, a command this shell cannot carry out on the installed tasks (see
 * windowsServiceManagementAccess). `command` is the command the user ran, for the refusal to suggest.
 */
function requireWindowsServiceManagementAccess(backend: ServiceBackend, verb: WindowsServiceManagementVerb, command = `pi-web ${verb}`): void {
  if (backend.kind !== "windows") return;
  const access = windowsServiceManagementAccess(installedWindowsStartMode(), () => windowsTaskContext("at-boot"));
  if (access === "ok") return;
  throw new Error(windowsServiceManagementRefusals[access](verb, command));
}

/** The refusal for a context that definitely cannot run the mode's tasks; an unknown context is left to the probe. */
function windowsTaskContextRefusal(startMode: WindowsTaskStartMode): WindowsTaskContextRefusal | undefined {
  const context = windowsTaskContext(startMode);
  return context === undefined || context === "ready" ? undefined : context;
}

const windowsStartModeLines: Readonly<Record<InstalledWindowsTaskStartMode, string>> = {
  "log-on": "- user services start at log-on with Windows scheduled tasks",
  "at-boot": "- user services start at boot with Windows scheduled tasks, whether or not anyone is signed in (full administrator rights)",
  "not-installed": "- user services start at log-on with Windows scheduled tasks",
  unreadable: "? start mode unknown: the session daemon's launcher records none PI WEB can read; run `pi-web install --at-log-on` from PowerShell opened as administrator, or `pi-web install --at-boot` there on an administrator account",
};

async function install(args: string[]): Promise<void> {
  const backend = requireServiceBackend("pi-web install");
  const options = parseInstallOptions(args);
  if (backend.kind === "windows" && options.mode === "dev") {
    throw new Error("`pi-web install --dev` is not supported with Windows scheduled tasks: the development scripts need bash. Install the production services with `pi-web install`.");
  }
  const windowsStartMode = installWindowsStartMode(backend, options.windowsStartMode);
  requireWindowsStartModeSwitchOutsidePiWeb(backend, windowsStartMode);
  requireWindowsServiceManagementAccess(backend, "install", windowsInstallCommand(options.windowsStartMode));
  const devRoot = options.mode === "dev" ? devRootPath() : undefined;
  if (devRoot !== undefined) validateDevCheckout(devRoot);
  const configPath = installConfigPath(options);
  const candidate = nativeServiceInstallCandidate(options, backend, configPath, devRoot);

  console.log(`Running PI WEB ${options.mode} install preflight checks...`);
  console.log(`Service backend: ${backend.label}`);
  console.log(`Service shell: ${describeServiceShell()}`);
  if (backend.kind === "windows") {
    console.log(`Start mode: ${windowsStartMode}`);
    const refusal = windowsTaskContextRefusal(windowsStartMode);
    if (refusal !== undefined) {
      console.log(`✗ ${windowsInstallContextRefusals[refusal](userInfo().username, windowsInstallCommand(options.windowsStartMode))}`);
      throw new Error("Install preflight checks failed without changing config or services.");
    }
  }
  if (!printNodePtyNativeModuleCheck("failure")) {
    throw new Error("Install preflight checks failed without changing config or services. Fix the failure above, then run `pi-web doctor` for more detail.");
  }
  const result = await installNativeServiceCandidate(candidate, {
    probe: nativeServiceProbes[backend.kind](windowsStartMode),
    fileExists: regularFileExists,
    writeInitialConfig: () => writeInitialConfig(options, configPath),
    replaceServices: (plan) => installNativeServices(plan, windowsStartMode),
  });
  if (!result.ok) {
    printNativeServiceInstallFailure(result.failure);
    if (nativeServiceInstallFailureNeedsPathAdvice(result.failure)) printPathSetupAdvice();
    throw new Error("Install preflight checks failed without changing config or services. Fix the failure above, then run `pi-web doctor` for more detail.");
  }
  for (const service of result.plan.services.filter((item) => item.strategy.kind === "configured-override")) {
    console.log(`! ${service.description} uses a configured command override; preflight did not execute that arbitrary command.`);
  }

  console.log(`\nPI WEB ${options.mode} services are installed and starting.`);
  console.log(`Config: ${configPath}`);
  if (options.mode === "dev") {
    console.log("Open: http://127.0.0.1:8505");
  } else {
    printInstalledOpenUrl(options.host, options.port, configPath);
  }

  if (backend.kind === "systemd") {
    const linger = isLingerEnabled();
    if (linger === false) {
      console.log("\nRecommended for server use: keep user services running after logout/reboot:");
      console.log(`  sudo loginctl enable-linger ${userInfo().username}`);
    } else if (linger === undefined) {
      console.log("\nRecommended for server use: enable systemd user lingering so services survive logout/reboot:");
      console.log(`  sudo loginctl enable-linger ${userInfo().username}`);
    }
  }
  if (backend.kind === "windows" && windowsStartMode === "at-boot") {
    console.log(`\nBoot: the tasks start at boot as ${userInfo().username}, whether or not anyone is signed in. They run with your full administrator rights, because Windows does not limit tasks that run without a sign-in, and without network credentials, so mapped drives and network shares are not available to them.`);
    console.log("  Stopping, starting, restarting or uninstalling PI WEB therefore needs PowerShell opened as administrator; to restart, you can also use the Updates page, or run `pi-web restart` in a PI WEB terminal.");
    console.log("  Any program running as your account, even in an ordinary window, can use PI WEB's tasks and files to get these rights without a UAC prompt; use `--at-boot` only where that is acceptable.");
  }
  if (backend.kind === "termux") {
    console.log(`\nBoot: wrote ${termuxBootScript}; the Termux:Boot app runs it when the phone starts.`);
    for (const line of termuxBootAppLines[currentTermuxBootAppState()]) console.log(line);
    console.log(termuxWakeCommandLine("termux-wake-lock"));
  }

  console.log("\nUseful commands:");
  console.log("  pi-web status");
  console.log("  pi-web logs");
  console.log("  pi-web restart");
}

/** The argument is the Windows tasks' start mode, whose principal the Windows probe runs with; the other probes ignore it. */
const nativeServiceProbes: Readonly<Record<NativeServiceBackendKind, (windowsStartMode: WindowsTaskStartMode) => NativeServiceAuthoritativeProbe>> = {
  systemd: createNativeServiceAuthoritativeProbe,
  launchd: createNativeServiceAuthoritativeProbe,
  termux: createNativeServiceAuthoritativeProbe,
  windows: createWindowsTaskProbe,
};

async function uninstall(): Promise<void> {
  const backend = requireServiceBackend("pi-web uninstall");
  requireWindowsServiceManagementAccess(backend, "uninstall");
  await uninstallRunners[uninstallPlacement(backend.kind, hostingServiceId(process.env), activeDockerMode(process.env) !== undefined)](backend);
}

const uninstallRunners: Readonly<Record<UninstallPlacement, (backend: ServiceBackend) => Promise<void>>> = {
  direct: uninstallHere,
  "scheduled-task": () => {
    handOffWindowsCommand("uninstall");
    return Promise.resolve();
  },
  "transient-unit": () => {
    handOffUninstallToTransientUnit();
    return Promise.resolve();
  },
  "one-shot-job": handOffUninstallToOneShotJob,
  detached: startDetachedUninstall,
};

async function uninstallHere(backend: ServiceBackend): Promise<void> {
  await uninstallNativeServices(backend);
  console.log(`PI WEB ${backend.label} removed. Production and development service files were removed; config and data were left in place.`);
  if (backend.kind === "termux") {
    console.log(`The Termux:Boot script ${termuxBootScript} was removed; your other boot scripts were left in place.`);
    console.log(termuxWakeCommandLine("termux-wake-unlock"));
  }
}

type TermuxWakeCommand = "termux-wake-lock" | "termux-wake-unlock";

const termuxWakeCommandOutcomes: Readonly<Record<TermuxWakeCommand, { done: string; failed: string }>> = {
  "termux-wake-lock": {
    done: "Wake lock: held, so Android does not suspend the services; Termux shows a notification while it is held. Release it with `termux-wake-unlock`.",
    failed: "Android may stop the services while Termux is in the background; run `termux-wake-lock` yourself.",
  },
  "termux-wake-unlock": {
    done: "Wake lock: released.",
    failed: "Release the wake lock from the Termux notification.",
  },
};

/** Best effort: the services are already installed or removed, so a wake-lock failure is reported and the command still succeeds. */
function termuxWakeCommandLine(command: TermuxWakeCommand): string {
  const result = capture(command, []);
  const outcome = termuxWakeCommandOutcomes[command];
  if (result.status === 0) return outcome.done;
  const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${String(result.status)}`;
  return `! \`${command}\` failed (${detail}). ${outcome.failed}`;
}

async function serviceAction(action: "stop" | "status"): Promise<void> {
  const backend = requireServiceBackend(`pi-web ${action}`);
  if (action === "status") {
    if (!printServiceStatusReport(backend)) process.exitCode = 1;
    return;
  }
  await performLifecycleServiceAction(backend, action, process.env);
}

async function performLifecycleServiceAction(
  backend: ServiceBackend,
  action: ServiceLifecycleAction,
  probeEnvironment: NodeJS.ProcessEnv,
): Promise<void> {
  requireWindowsServiceManagementAccess(backend, action);
  const refs = installedServiceRefs(backend);
  if (backend.kind === "windows" && action === "restart" && refs.some((ref) => restartsInPlace(ref.id, hostingServiceId(process.env)))) {
    handOffWindowsCommand("restart");
    return;
  }
  const input: ServiceActionInput = {
    backend,
    action,
    refs,
    launchdContext: launchdActionContext(),
    windowsContext: { launcherPath: windowsLauncherPath, taskName: windowsTaskName },
  };
  const result: ServiceActionResult = await performServiceAction(input, serviceActionDeps(backend, probeEnvironment));
  if (result.unreadyServices.length > 0) {
    for (const ref of result.unreadyServices) {
      console.log(`✗ ${serviceDisplayName(ref)} did not become ready (${serviceManagerTargets[backend.kind](ref)}).`);
    }
    console.log("  Check `pi-web status` and `pi-web logs` for details.");
    process.exitCode = 1;
  }
}

const handedOffCommandOutcomes: Readonly<Record<WindowsCliHandOffVerb, string>> = {
  restart: "restarts the services",
  uninstall: "removes the services",
};

function printHandedOffNotice(runner: string, verb: WindowsCliHandOffVerb, logPath: string): void {
  console.log(`This command runs inside the PI WEB session daemon, so ${runner} ${handedOffCommandOutcomes[verb]} instead.`);
  console.log(`  Its output goes to ${logPath}; check \`pi-web status\` once it has finished.`);
}

function handedOffLogPath(verb: WindowsCliHandOffVerb): string {
  mkdirSync(logDir, { recursive: true });
  return join(logDir, `${verb}.log`);
}

/**
 * A restart or uninstall started inside the session daemon (a PI WEB terminal, the Updates page)
 * cannot stop that daemon's task and still be alive to finish, so a transient task runs it instead.
 */
function handOffWindowsCommand(verb: WindowsCliHandOffVerb): void {
  const logPath = handedOffLogPath(verb);
  const userName = userInfo().username;
  const startMode = windowsTaskStartModeInUse[installedWindowsStartMode()];
  runWindowsTaskScript(windowsCliHandOffScript({ verb, cliPath: fileURLToPath(import.meta.url), userName, userSid: currentWindowsUserSid(), logPath, startMode }));
  printHandedOffNotice(`the scheduled task "${windowsCliHandOffTaskName(verb, userName)}"`, verb, logPath);
}

/**
 * Run the uninstall in a child of its own session (a detached spawn calls setsid), so stopping the
 * session daemon, which closes this PI WEB terminal and hangs up its jobs, does not end it. The
 * child's environment has no PI WEB session marker, so it uninstalls directly.
 */
async function startDetachedUninstall(): Promise<void> {
  const logPath = handedOffLogPath("uninstall");
  const log = openSync(logPath, "a");
  try {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "uninstall"], { detached: true, stdio: ["ignore", log, log], env: environmentOutsideSession(process.env) });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", () => { resolve(); });
    });
    child.unref();
  } finally {
    closeSync(log);
  }
  printHandedOffNotice("a detached `pi-web uninstall`", "uninstall", logPath);
}

/** The command line that runs `pi-web uninstall` from this CLI file under the current Node.js, so the hand-off uses the build that asked for it rather than whichever `pi-web` PATH finds. */
function uninstallHandOffCommand(): UninstallHandOffCommand {
  return {
    command: [process.execPath, ...process.execArgv, fileURLToPath(import.meta.url), "uninstall"],
    workingDirectory: existingWorkingDirectory(),
  };
}

/** `process.cwd()` throws once the directory it names has been deleted; the hand-off then runs from its runner's default directory. */
function existingWorkingDirectory(): string | undefined {
  try {
    return process.cwd();
  } catch {
    return undefined;
  }
}

/** A hand-off that did not start has changed nothing, so the uninstall refuses rather than running here and dying halfway. */
function requireUninstallHandOffStarted(runner: string, result: { status: number; stdout: string; stderr: string }): void {
  if (result.status === 0) return;
  const detail = firstOutputLine(result.stderr, result.stdout) ?? `exit status ${String(result.status)}`;
  throw new Error(`Could not start ${runner} to run \`pi-web uninstall\` outside PI WEB: ${detail}\nNothing was uninstalled. Run \`pi-web uninstall\` from a terminal outside PI WEB, such as an SSH session.`);
}

/** Run the uninstall in a transient systemd user unit, outside the session daemon's cgroup, which the uninstall stops. */
function handOffUninstallToTransientUnit(): void {
  const logPath = handedOffLogPath("uninstall");
  const runner = `the transient systemd unit "${uninstallTransientUnitName}"`;
  requireUninstallHandOffStarted(runner, capture("systemd-run", uninstallTransientUnitArgs(uninstallHandOffCommand(), logPath, process.env["PATH"])));
  printHandedOffNotice(runner, "uninstall", logPath);
}

/**
 * Run the uninstall in a one-shot launchd job, outside the session daemon's job, which the
 * uninstall boots out. launchd reads the job's definition when the job is bootstrapped, so the
 * definition file is removed straight after. A job left loaded under the same label, by a
 * self-bootout that failed or by an earlier hand-off, would make the bootstrap fail, so it is
 * booted out first; its absence is the usual case and is not an error.
 */
async function handOffUninstallToOneShotJob(): Promise<void> {
  const logPath = handedOffLogPath("uninstall");
  const runner = `the one-shot launchd job "${uninstallOneShotJobLabel}"`;
  const domain = launchdDomain();
  const definitionDirectory = await mkdtemp(join(tmpdir(), "pi-web-uninstall-"));
  try {
    const plistPath = join(definitionDirectory, `${uninstallOneShotJobLabel}.plist`);
    const jobTarget = `${domain}/${uninstallOneShotJobLabel}`;
    const programArguments = uninstallOneShotJobArguments(uninstallHandOffCommand(), jobTarget);
    await writeFile(plistPath, renderLaunchdOneShotPlist(uninstallOneShotJobLabel, programArguments, logPath), { mode: 0o600 });
    runQuiet("launchctl", launchdBootoutArgs(jobTarget));
    requireUninstallHandOffStarted(runner, capture("launchctl", launchdBootstrapArgs(domain, plistPath)));
  } finally {
    await rm(definitionDirectory, { recursive: true, force: true });
  }
  printHandedOffNotice(runner, "uninstall", logPath);
}

export interface SessionDaemonRestartPlanOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  configPath?: string;
  explicitConfigPath?: boolean;
  serviceFileExists?: (path: string) => boolean;
  runCommand?: (command: string, args: string[]) => void;
  uid?: number;
  isSystemdBooted?: () => boolean;
}

/** Offline restart guidance used only after a recovery config mutation. */
export function sessionDaemonRestartPlan(options: SessionDaemonRestartPlanOptions = {}): SessionDaemonRestartPlan {
  const env = options.env ?? process.env;
  if (options.explicitConfigPath === true && options.configPath !== undefined) {
    return {
      kind: "manual",
      guidance: `Restart the session daemon process configured with PI_WEB_CONFIG=${JSON.stringify(options.configPath)}.`,
    };
  }
  const dockerMode = activeDockerMode(env);
  const runCommand = options.runCommand ?? ((command, args) => { run(command, args, { check: true }); });
  if (dockerMode !== undefined) {
    const command = piWebDockerCommand(dockerMode, "restart-sessiond");
    return {
      kind: "automatic",
      command,
      guidance: "Run the Docker control command from the PI WEB Docker host.",
      perform: () => {
        runCommand("pi-web-docker", [...(dockerMode === "dev" ? ["--dev"] : []), "restart-sessiond"]);
      },
    };
  }

  const backend = serviceBackendForPlatform(options.platform ?? process.platform, env, options.isSystemdBooted);
  const fileExists = options.serviceFileExists ?? existsSync;
  if (backend?.kind === "systemd" && fileExists(systemdServicePath(serviceRefs.sessiond))) {
    const args = ["--user", "restart", serviceRefs.sessiond.systemdName];
    return {
      kind: "automatic",
      command: `systemctl ${args.join(" ")}`,
      guidance: "Run:",
      perform: () => { runCommand("systemctl", args); },
    };
  }
  if (backend?.kind === "termux" && fileExists(termuxRunScriptPath(serviceRefs.sessiond))) {
    const args = termuxServiceActionArgs("restart", [termuxServiceDirectory(serviceRefs.sessiond)]);
    return {
      kind: "automatic",
      command: `sv ${args.join(" ")}`,
      guidance: "Run:",
      perform: () => { runCommand("sv", args); },
    };
  }
  if (backend?.kind === "launchd" && fileExists(launchdPlistPath(serviceRefs.sessiond))) {
    const target = `gui/${String(options.uid ?? userInfo().uid)}/${serviceRefs.sessiond.launchdLabel}`;
    const args = ["kickstart", "-k", target];
    return {
      kind: "automatic",
      command: `launchctl ${args.join(" ")}`,
      guidance: "Run:",
      perform: () => { runCommand("launchctl", args); },
    };
  }
  if (backend?.kind === "windows" && fileExists(windowsLauncherPath(serviceRefs.sessiond))) {
    const name = windowsTaskName(serviceRefs.sessiond);
    const script = [windowsTaskStopScript(windowsLauncherRefs([serviceRefs.sessiond])), windowsTaskStartScript([name])].join("\n");
    const handsOff = restartsInPlace("sessiond", hostingServiceId(env));
    return {
      kind: "automatic",
      command: handsOff ? "pi-web restart" : `Stop-ScheduledTask -TaskName ${powerShellLiteral(name)}; Start-ScheduledTask -TaskName ${powerShellLiteral(name)}`,
      guidance: "Run in PowerShell:",
      perform: () => {
        if (handsOff) {
          handOffWindowsCommand("restart");
          return;
        }
        requireWindowsServiceManagementAccess(backend, "restart");
        runCommand(windowsPowerShell, windowsPowerShellArguments(script));
      },
    };
  }
  return {
    kind: "manual",
    guidance: "Stop and rerun the process that owns sessiond (from a checkout: `pnpm run start:sessiond`).",
  };
}

function activeDockerMode(env: NodeJS.ProcessEnv): PiWebDockerMode | undefined {
  if (!truthyEnvValue(ownEnvironmentValue(env, "PI_WEB_DOCKER_RUNTIME"))) return undefined;
  if (ownEnvironmentValue(env, "PI_WEB_DOCKER_MODE") === "dev") return "dev";
  return "runtime";
}

function truthyEnvValue(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

const logFollowers: Readonly<Record<NativeServiceBackendKind, (refs: readonly ServiceRef[]) => void>> = {
  systemd: (refs) => { run("journalctl", ["--user", ...refs.flatMap((ref) => ["-u", ref.systemdName]), "-f"]); },
  launchd: (refs) => { run("tail", ["-F", ...refs.map((ref) => launchdLogPath(ref))]); },
  termux: (refs) => { run("tail", ["-F", ...refs.map((ref) => launchdLogPath(ref))]); },
  windows: (refs) => { followLogFiles(refs.map((ref) => launchdLogPath(ref))); },
};

function logs(): void {
  const backend = requireServiceBackend("pi-web logs");
  logFollowers[backend.kind](installedServiceRefs(backend));
}

function serviceShellLabel(): string {
  return `${detectServiceShell().name} -lc`;
}

function commandCheck(command: string): string {
  return `command -v ${serviceShellQuote(command)}`;
}

export function commandWithVersionCheck(command: string): string {
  const found = commandCheck(command);
  const commandWord = serviceShellQuote(command);
  if (detectServiceShell().name === "fish") {
    return `${found} && begin; ${commandWord} --version 2>&1 || true; end`;
  }
  return `${found} && (${commandWord} --version 2>&1 || true)`;
}

export function nodeVersionCheck(): string {
  return nativeServicePrerequisiteShellCheck(detectServiceShell().name, {
    id: "caller.node",
    kind: "node-version",
    command: "node",
    minimumVersion: minimumSupportedNodeVersion,
    description: `node >= ${minimumSupportedNodeVersion}`,
  });
}

function callerPowerShellCommand(script: string): string[] {
  return [windowsPowerShell, ...windowsPowerShellArguments(script)];
}

export function generalDoctorChecks(): Check[] {
  if (currentServiceBackend()?.kind === "windows") {
    return [
      [`Caller PowerShell can find node >= ${minimumSupportedNodeVersion}`, callerPowerShellCommand(windowsCallerNodeVersionScript(minimumSupportedNodeVersion))],
      ["Caller PowerShell can find npm", callerPowerShellCommand(windowsCallerCommandScript("npm", true))],
      ["Caller PowerShell can find pi", callerPowerShellCommand(windowsCallerCommandScript("pi", true))],
    ];
  }
  const shell = serviceShellLabel();
  return [
    [`Caller login ${shell} can find node >= ${minimumSupportedNodeVersion}`, serviceShellCommand(nodeVersionCheck())],
    [`Caller login ${shell} can find npm`, serviceShellCommand(commandWithVersionCheck("npm"))],
    // Sessions run on the bundled pi SDK; the only CLI check is a hardcoded
    // `pi` PATH probe — nothing names or locates a configurable command.
    [`Caller login ${shell} can find pi`, serviceShellCommand(commandWithVersionCheck("pi"))],
  ];
}

function runChecks(checks: Check[]): boolean {
  let failed = false;
  for (const [label, command] of checks) {
    const [bin, ...args] = command;
    if (bin === undefined) continue;
    const result = capture(bin, args);
    const ok = result.status === 0;
    failed ||= !ok;
    console.log(`${ok ? "✓" : "✗"} ${label}`);
    printCheckOutput(result.stdout || result.stderr);
  }
  return !failed;
}

function printCheckOutput(output: string): void {
  const trimmed = output.trim();
  if (trimmed === "") return;
  const lines = trimmed.split("\n");
  for (const line of lines.slice(0, 3)) console.log(`  ${line}`);
  if (lines.length > 3) console.log("  ...");
}

function optionalDoctorChecks(): Check[] {
  if (currentServiceBackend()?.kind === "windows") {
    return [["Caller PowerShell can find optional ripgrep (rg)", callerPowerShellCommand(windowsCallerCommandScript("rg", false))]];
  }
  const shell = serviceShellLabel();
  return [[`Caller login ${shell} can find optional ripgrep (rg)`, serviceShellCommand(commandCheck("rg"))]];
}

function printOptionalDoctorChecks(): void {
  let missingOptionalTool = false;
  for (const [label, command] of optionalDoctorChecks()) {
    const [bin, ...args] = command;
    if (bin === undefined) continue;
    const result = capture(bin, args);
    const ok = result.status === 0;
    missingOptionalTool ||= !ok;
    console.log(`${ok ? "✓" : "!"} ${label}`);
    printCheckOutput(result.stdout || result.stderr);
  }
  if (missingOptionalTool) {
    console.log("  Install ripgrep, or make rg visible to the service shell, for faster all-file @ suggestions.");
    console.log("  PI WEB falls back to a bounded filesystem scan when rg is unavailable.");
  }
}

function installedServiceDefinitions(
  backend: ServiceBackend,
  ids: readonly ServiceId[],
  purpose: InstalledNativeServiceDefinitionPurpose,
): InstalledNativeServiceInspection<readonly InstalledNativeServiceDefinition[]> {
  const sources: InstalledNativeServiceDefinitionSource[] = ids.map((id) => ({
    id,
    path: serviceFilePath(backend, serviceRefs[id]),
    systemdName: serviceRefs[id].systemdName,
    launchdTarget: currentLaunchdServiceTarget(serviceRefs[id]),
  }));
  return inspectInstalledNativeServiceDefinitions(backend, sources, {
    readFile: (path) => readFileSync(path),
    realpath: realpathSync,
    capture: captureInstalledServiceDefinitionCommand,
  }, purpose);
}

/** Build an isolated probe environment without mutating the caller or process. */
export function managedServiceProbeEnvironment(
  backend: ServiceBackend,
  definitions: readonly InstalledNativeServiceDefinition[],
  callerEnvironment: NodeJS.ProcessEnv,
): InstalledNativeServiceInspection<NodeJS.ProcessEnv> {
  const selection = selectManagedNativeServiceConfig(
    backend,
    definitions,
    ownEnvironmentValue(callerEnvironment, "PI_WEB_CONFIG"),
  );
  if (!selection.ok) return selection;
  if (selection.value.source === "installed") {
    return {
      ok: true,
      value: { ...callerEnvironment, PI_WEB_CONFIG: selection.value.configPath },
    };
  }
  if (selection.value.source === "default" && definitions.length > 0) {
    // An own empty value preserves default resolution while masking any
    // prototype-inherited PI_WEB_CONFIG from downstream environment lookups.
    return { ok: true, value: { ...callerEnvironment, PI_WEB_CONFIG: "" } };
  }
  return { ok: true, value: callerEnvironment };
}

function installedServiceProbeEnvironment(
  backend: ServiceBackend,
  ids: ReadonlySet<ServiceId>,
  callerEnvironment: NodeJS.ProcessEnv,
  purpose: InstalledNativeServiceDefinitionPurpose,
  inspectDefinitions: (
    backend: ServiceBackend,
    ids: readonly ServiceId[],
    purpose: InstalledNativeServiceDefinitionPurpose,
  ) => InstalledNativeServiceInspection<readonly InstalledNativeServiceDefinition[]>,
): InstalledNativeServiceInspection<NodeJS.ProcessEnv> {
  // The explicit caller override wins without requiring installed definitions
  // to be readable or canonical.
  const callerConfigPath = ownEnvironmentValue(callerEnvironment, "PI_WEB_CONFIG");
  if (callerConfigPath !== undefined && callerConfigPath !== "") {
    return { ok: true, value: callerEnvironment };
  }
  if (ids.size === 0) return { ok: true, value: callerEnvironment };

  const definitions = inspectDefinitions(backend, [...ids], purpose);
  if (!definitions.ok) return definitions;
  return managedServiceProbeEnvironment(backend, definitions.value, callerEnvironment);
}

function managedServiceProbeFailure(backend: ServiceBackend, message: string): string {
  return [
    `Could not select managed PI_WEB_CONFIG from installed ${backend.label}: ${message}`,
    "Repair the reported service-manager override or definition, then re-run `pi-web install` (or `pi-web install --dev`); a nonempty PI_WEB_CONFIG explicitly overrides managed config selection for this command.",
  ].join("\n");
}

export type ReadinessCliCommand = "start" | "restart" | "doctor" | "version";

export interface ReadinessDoctorCommandContext {
  backend: ServiceBackend | undefined;
  installedIds: ReadonlySet<ServiceId>;
  environment: NodeJS.ProcessEnv;
  versionReportOptions: PiWebVersionReportOptions;
  managedInspectionFailed: boolean;
}

export interface ReadinessCliCommandDependencies {
  environment: NodeJS.ProcessEnv;
  currentBackend: () => ServiceBackend | undefined;
  requireBackend: (command: string) => ServiceBackend;
  installedServiceIds: (backend: ServiceBackend) => ReadonlySet<ServiceId>;
  inspectDefinitions: (
    backend: ServiceBackend,
    ids: readonly ServiceId[],
    purpose: InstalledNativeServiceDefinitionPurpose,
  ) => InstalledNativeServiceInspection<readonly InstalledNativeServiceDefinition[]>;
  runLifecycle: (
    backend: ServiceBackend,
    action: "start" | "restart",
    probeEnvironment: NodeJS.ProcessEnv,
  ) => Promise<void>;
  runDoctor: (context: ReadinessDoctorCommandContext) => Promise<void>;
  printVersion: () => Promise<void>;
}

/**
 * Dispatch commands whose probes may need managed config. The service-manager,
 * definition, lifecycle, doctor, and version boundaries are injected so this
 * exact orchestration can be tested without mutating live services or process
 * environment.
 */
export async function runReadinessCliCommand(
  command: ReadinessCliCommand,
  dependencies: ReadinessCliCommandDependencies,
): Promise<void> {
  if (command === "version") {
    await dependencies.printVersion();
    return;
  }

  const environment = dependencies.environment;
  if (command === "start" || command === "restart") {
    const backend = dependencies.requireBackend(`pi-web ${command}`);
    const installedIds = dependencies.installedServiceIds(backend);
    const probeEnvironment = installedServiceProbeEnvironment(
      backend,
      installedIds,
      environment,
      command,
      dependencies.inspectDefinitions,
    );
    if (!probeEnvironment.ok) throw new Error(managedServiceProbeFailure(backend, probeEnvironment.message));
    await dependencies.runLifecycle(backend, command, probeEnvironment.value);
    return;
  }

  const backend = dependencies.currentBackend();
  const installedIds = backend === undefined
    ? new Set<ServiceId>()
    : dependencies.installedServiceIds(backend);
  let versionReportOptions: PiWebVersionReportOptions = { configEnv: environment };
  let managedInspectionFailed = false;
  if (backend !== undefined && activeDockerMode(environment) === undefined) {
    const probeEnvironment = installedServiceProbeEnvironment(
      backend,
      installedIds,
      environment,
      "doctor",
      dependencies.inspectDefinitions,
    );
    if (probeEnvironment.ok) {
      versionReportOptions = { configEnv: probeEnvironment.value };
    } else {
      managedInspectionFailed = true;
      versionReportOptions = { webEndpointError: managedServiceProbeFailure(backend, probeEnvironment.message) };
    }
  }
  await dependencies.runDoctor({
    backend,
    installedIds,
    environment,
    versionReportOptions,
    managedInspectionFailed,
  });
}

function readinessCliCommandDependencies(): ReadinessCliCommandDependencies {
  return {
    environment: process.env,
    currentBackend: currentServiceBackend,
    requireBackend: requireServiceBackend,
    installedServiceIds,
    inspectDefinitions: installedServiceDefinitions,
    runLifecycle: performLifecycleServiceAction,
    runDoctor: doctor,
    printVersion: async () => { await printPiWebVersionReport(); },
  };
}

function nativeServiceDoctorTarget(
  backend: ServiceBackend,
  ids: ReadonlySet<ServiceId>,
): NativeServiceDoctorTarget {
  const mode = inferInstalledNativeServiceMode(ids);
  if (mode === "ambiguous") {
    return {
      kind: "inspection-failure",
      message: `installed service IDs do not identify one mode (${[...ids].join(", ") || "none"}).`,
    };
  }
  if (mode === "none") {
    return {
      kind: "prospective-production",
      input: productionNativeServicePlanInput(backend, detectServiceShell(), {}),
      reason: "no installed service strategy is available",
    };
  }
  const expectedIds = mode === "production"
    ? productionNativeServiceIds
    : (["sessiond", "uiDev"] as const);
  const missingId = expectedIds.find((id) => !ids.has(id));
  if (missingId !== undefined) {
    return {
      kind: "inspection-failure",
      message: `installed ${mode} service set is incomplete; ${missingId} is missing.`,
    };
  }

  const definitions = installedServiceDefinitions(backend, expectedIds, "doctor");
  if (!definitions.ok) return { kind: "inspection-failure", message: definitions.message };

  if (mode === "development") {
    const inspection = inspectInstalledDevelopmentServiceInput(backend, definitions.value);
    return inspection.ok
      ? { kind: "installed-development", input: inspection.value }
      : { kind: "inspection-failure", message: inspection.message };
  }

  const inspection = inspectInstalledProductionServiceContext(backend, definitions.value);
  return inspection.ok
    ? {
        kind: "prospective-production",
        input: productionNativeServicePlanInput(backend, inspection.value.shell, inspection.value.environment),
        reason: "installed executable strategy is not recorded",
      }
    : { kind: "inspection-failure", message: inspection.message };
}

async function printNativeServiceDoctorChecks(
  backend: ServiceBackend,
  installedIds: ReadonlySet<ServiceId>,
  windowsStartMode: WindowsTaskStartMode,
): Promise<NativeServiceDoctorReport> {
  const result = await runNativeServiceDoctor(nativeServiceDoctorTarget(backend, installedIds), {
    probe: nativeServiceProbes[backend.kind](windowsStartMode),
    fileExists: regularFileExists,
  });
  const report = formatNativeServiceDoctorResult(result);
  for (const line of report.lines) console.log(line);
  printCallerContextComparisons(report);
  return report;
}

function printCallerContextComparisons(report: NativeServiceDoctorReport): void {
  if (report.plan === null || report.failedPrerequisites.length === 0) return;
  const seen = new Set<string>();
  for (const prerequisite of report.failedPrerequisites) {
    if (seen.has(prerequisite.id)) continue;
    seen.add(prerequisite.id);
    if (report.plan.backend.kind === "windows") {
      const [bin = windowsPowerShell, ...args] = callerPowerShellCommand(windowsCallerPrerequisiteScript(prerequisite));
      const result = capture(bin, args);
      console.log(`  Caller PowerShell ${result.status === 0 ? "satisfies" : "also does not satisfy"} ${prerequisite.description}; the scheduled-task result is authoritative.`);
      continue;
    }
    const service = report.plan.services.find((candidate) => candidate.prerequisites.some((item) => item.id === prerequisite.id));
    const command = nativeServicePrerequisiteShellCheck(report.plan.shell.name, prerequisite);
    const result = captureServiceShell(report.plan.shell, command, service?.workingDirectory ?? null);
    console.log(
      `  Caller-invoked ${report.plan.shell.name} -lc ${result.status === 0 ? "satisfies" : "also does not satisfy"} ${prerequisite.description}; the service-manager result is authoritative.`,
    );
  }
}

function captureServiceShell(
  shell: NativeServiceShell,
  command: string,
  workingDirectory: string | null,
): { status: number; stdout: string; stderr: string } {
  const fullCommand = workingDirectory === null
    ? command
    : `cd ${shellQuoteFor(shell.name, workingDirectory)} && ${command}`;
  return capture("/usr/bin/env", [shell.executable, "-lc", fullCommand]);
}

function shellQuoteFor(shell: NativeServiceShell["name"], value: string): string {
  return shell === "fish" ? fishSingleQuote(value) : shellSingleQuote(value);
}

function printPathSetupAdvice(shell: NativeServiceShell = detectServiceShell()): void {
  console.log("\nPATH setup advice:");
  if (shell.name === "bash") {
    console.log("  Detected bash. Put PATH setup for node/version managers/tools in ~/.bash_profile or ~/.profile.");
    console.log("  If ~/.bash_profile exists, bash will not read ~/.profile unless you source it from ~/.bash_profile.");
    console.log("  Do not rely only on ~/.bashrc or prompt hooks for tools needed by services or agents.");
  } else if (shell.name === "cmd") {
    console.log("  Windows scheduled tasks get PATH from your user and system environment variables (System Properties > Environment Variables),");
    console.log("  not from a PowerShell profile or the current window. Add the folders of node, npm and pi there, then run `pi-web restart`.");
  } else if (shell.name === "zsh") {
    console.log("  Detected zsh. Put PATH setup for node/version managers/tools in ~/.zprofile, not only ~/.zshrc.");
    console.log("  Avoid relying on prompt hooks; PI WEB services run non-interactive login shells.");
  } else {
    console.log("  Detected fish. Prefer universal PATH setup such as `fish_add_path -U ...` for tools needed by services or agents.");
    console.log("  Avoid relying on prompt hooks; PI WEB services run non-interactive login shells.");
  }
}

/**
 * Running components an installed deployment must keep ready: the API-serving
 * component whenever the web or UI dev service file is installed (the version
 * endpoint probes the API port in both modes), and the session daemon whenever
 * its service file is installed. Docker deployments have no native service
 * files, so the Docker runtime marker expects both components. A machine with
 * nothing installed expects nothing: doctor's manual-run guidance stays a
 * passing outcome there.
 */
export function expectedRunningComponents(
  installedServices: ReadonlySet<NativeServiceId>,
  env: NodeJS.ProcessEnv,
): RunningComponentId[] {
  if (activeDockerMode(env) !== undefined) return ["web", "sessiond"];
  const expected: RunningComponentId[] = [];
  if (installedServices.has("web") || installedServices.has("uiDev")) expected.push("web");
  if (installedServices.has("sessiond")) expected.push("sessiond");
  return expected;
}

/** A node-pty that does not load is only a warning (owner, 2026-10-21): sessions keep working without terminals. */
export function doctorExitCode(
  generalReadinessOk: boolean,
  nativeServicePlanOk: boolean,
  nodePtySpawnHelperOk: boolean,
  runningComponentsOk: boolean,
): 0 | 1 {
  return generalReadinessOk && nativeServicePlanOk && nodePtySpawnHelperOk && runningComponentsOk ? 0 : 1;
}

async function doctor(context: ReadinessDoctorCommandContext): Promise<void> {
  const { backend, installedIds, environment, versionReportOptions, managedInspectionFailed } = context;
  console.log(`Platform: ${platformLabel()}`);
  console.log(`Service backend: ${backend?.label ?? "manual run only"}`);
  console.log(`Service shell: ${describeServiceShell()}`);
  if (backend === undefined) {
    console.log(`- Native user service plan checks skipped on ${noServiceManagerHost()}; no native-service drift is reported.`);
  }
  console.log("");

  const runningVersionInfo = await printPiWebVersionReport(versionReportOptions);
  const expectedComponents = expectedRunningComponents(installedIds, environment);
  const runningComponentsOk = runningComponentsReady(runningVersionInfo, expectedComponents);
  if (!runningComponentsOk) {
    console.log("\n✗ Installed PI WEB services are unavailable or stale (see \"Running services\" above).");
    console.log("  Run `pi-web restart`, then check `pi-web status`.");
  }

  console.log("\nGeneral login-shell readiness (separate from native-service requirements):");
  const generalReadinessOk = runChecks(generalDoctorChecks());
  printOptionalDoctorChecks();

  console.log("\nNative terminal runtime readiness:");
  const nodePtyNativeModuleOk = printNodePtyNativeModuleCheck("warning");
  const nodePtySpawnHelperOk = nodePtyNativeModuleOk ? printNodePtyDarwinSpawnHelperCheck() : true;

  let nativeServiceReport: NativeServiceDoctorReport | null = null;
  const installedWindowsMode = backend?.kind === "windows" ? installedWindowsStartMode() : "not-installed";
  const windowsStartMode = windowsTaskStartModeInUse[installedWindowsMode];
  if (backend !== undefined) {
    console.log("\nNative service plan checks (service-manager context):");
    const windowsRefusal = backend.kind === "windows" && !managedInspectionFailed ? windowsTaskContextRefusal(windowsStartMode) : undefined;
    if (managedInspectionFailed) {
      console.log("✗ Installed native-service plan could not be inspected consistently with the readiness probe (see \"Running services\" above).");
      console.log("  Repair the reported service-manager definition before relying on doctor results.");
    } else if (windowsRefusal !== undefined) {
      console.log(windowsDoctorContextNotices[windowsRefusal](userInfo().username));
    } else {
      nativeServiceReport = await printNativeServiceDoctorChecks(backend, installedIds, windowsStartMode);
    }
  }

  if (backend?.kind === "systemd") {
    const linger = isLingerEnabled();
    if (linger === true) {
      console.log("✓ systemd user lingering enabled");
    } else if (linger === false) {
      console.log("✗ systemd user lingering disabled");
      console.log(`  Recommended on servers: sudo loginctl enable-linger ${userInfo().username}`);
    } else {
      console.log("? systemd user lingering unknown");
      console.log(`  Recommended on servers: sudo loginctl enable-linger ${userInfo().username}`);
    }
  } else if (backend?.kind === "launchd") {
    console.log("- user services start at login with LaunchAgents");
  } else if (backend?.kind === "termux") {
    printTermuxBootChecks(installedIds.size > 0);
  } else if (backend?.kind === "windows") {
    console.log(windowsStartModeLines[installedWindowsMode]);
  } else {
    console.log(`- systemd user lingering skipped on ${platformLabel()}`);
  }

  const nativeServicePlanOk = !managedInspectionFailed && (nativeServiceReport?.ok ?? true);
  const pathFailure = !generalReadinessOk || nativeServiceReport?.pathAdviceRecommended === true;
  if (pathFailure) {
    console.log("\nIf a command works in your terminal but fails in the service-manager check, compare the caller and manager contexts above.");
    const adviceShell = nativeServiceReport?.pathAdviceRecommended === true && nativeServiceReport.adviceShell !== null
      ? nativeServiceReport.adviceShell
      : detectServiceShell();
    printPathSetupAdvice(adviceShell);
  }

  const manualRunReadinessOk = backend === undefined && activeDockerMode(environment) === undefined ? await printManualRunReadiness(environment) : true;

  const httpsCertificateOk = printHttpsCertificateCheck(versionReportOptions.configEnv);
  const accessTokenOk = printAccessTokenCheck(versionReportOptions.configEnv);

  if (doctorExitCode(generalReadinessOk, nativeServicePlanOk, nodePtySpawnHelperOk, runningComponentsOk) !== 0 || !httpsCertificateOk || !manualRunReadinessOk || !accessTokenOk) process.exitCode = 1;
}

/** Without a service manager, doctor checks what `pi-web run` or a manual run needs, then says how to run it. */
async function printManualRunReadiness(environment: NodeJS.ProcessEnv): Promise<boolean> {
  console.log("\nManual run readiness (no service manager):");
  const readiness = await manualRunReadiness(environment);
  for (const line of readiness.lines) console.log(line);
  console.log(`\n${currentManualRunAdvice()}`);
  return readiness.ok;
}

/**
 * Where the installed web/API answers. The services do not receive this shell's PI_WEB_TLS_*
 * variables, so only the config file decides the scheme; an HTTPS certificate names the hosts
 * a browser accepts, which `--host` (a bind address) usually is not.
 */
function printInstalledOpenUrl(host: string, port: string, configPath: string): void {
  const address = host === "0.0.0.0" ? "127.0.0.1" : host;
  let tls;
  try {
    tls = piWebTlsConfig({ env: { ...process.env, PI_WEB_CONFIG: configPath, PI_WEB_TLS_CERT: "", PI_WEB_TLS_KEY: "" } });
  } catch (error) {
    console.log(`HTTPS config: ${describeError(error)}`);
    return;
  }
  if (tls === undefined) {
    console.log(`Open: http://${address}:${port}`);
    return;
  }
  console.log(`Open: https://<a name the certificate covers>:${port}`);
  try {
    console.log(`  Certificate names: ${readTlsCredentials(tls).names}`);
  } catch (error) {
    console.log(`  ${describeError(error)}`);
  }
}

/** The HTTPS certificate the web/API would start with: one it cannot use, or a TLS config it cannot read, keeps the web/API from starting at all. */
function printHttpsCertificateCheck(configEnv: NodeJS.ProcessEnv | undefined): boolean {
  console.log("\nHTTPS:");
  let tls;
  try {
    tls = piWebTlsConfig({ env: configEnv ?? process.env });
  } catch (error) {
    console.log(`✗ ${describeError(error)}`);
    console.log("  The web/API does not start until the TLS config is fixed.");
    return false;
  }
  if (tls === undefined) {
    console.log("- not configured; the web/API serves plain HTTP");
    return true;
  }
  try {
    const credentials = readTlsCredentials(tls);
    console.log(`✓ certificate ${tls.certFile} for ${credentials.names}, valid until ${credentials.validTo}`);
    return true;
  } catch (error) {
    console.log(`✗ ${describeError(error)}`);
    console.log("  The web/API does not start until the certificate and key can be used.");
    return false;
  }
}

function currentTermuxBootAppState(): TermuxBootAppState {
  return termuxBootAppState(capture("pm", termuxBootAppListArgs(userInfo().uid)));
}

const termuxBootAppLines: Readonly<Record<TermuxBootAppState, readonly string[]>> = {
  installed: ["✓ Termux:Boot app installed"],
  "not-installed": [
    "✗ Termux:Boot app not installed: the services will not start when the phone boots until it is.",
    "  Install Termux:Boot from the same source as Termux, then open it once.",
  ],
  unknown: [
    "? Termux:Boot app could not be checked; without it the services do not start when the phone boots.",
  ],
};

/** Boot start is reported like systemd lingering: it decides whether services come back after a reboot, not whether they run now. */
function printTermuxBootChecks(servicesInstalled: boolean): void {
  if (existsSync(termuxBootScript)) {
    console.log(`✓ boot script ${termuxBootScript} starts the services when the phone boots`);
  } else if (servicesInstalled) {
    console.log(`✗ boot script ${termuxBootScript} is missing; run \`pi-web install\` to write it`);
  } else {
    console.log(`- no boot script; \`pi-web install\` writes ${termuxBootScript}`);
  }
  for (const line of termuxBootAppLines[currentTermuxBootAppState()]) console.log(line);
}

function printNodePtyNativeModuleCheck(severity: NodePtyLoadFailureSeverity): boolean {
  const buildHost = process.platform === "linux" && !isTermuxEnvironment(process.env) ? "linux" : "other";
  const result = formatNodePtyNativeModuleCheck(checkNodePtyNativeModule(), severity, buildHost);
  for (const line of result.lines) console.log(line);
  if (!result.ok && currentServiceBackend()?.kind === "termux") {
    console.log("  On Termux, npm can build node-pty only when ~/.gyp/include.gypi sets android_ndk_path; the curl installer writes it. See the Termux section of docs/install.md.");
  }
  return result.ok;
}

function printNodePtyDarwinSpawnHelperCheck(): boolean {
  const result = formatNodePtyDarwinSpawnHelperCheck(checkNodePtyDarwinSpawnHelper());
  for (const line of result.lines) console.log(line);
  return result.ok;
}

async function foregroundRun(args: readonly string[]): Promise<void> {
  const refusal = foregroundRunRefusal(args, process.platform);
  if (refusal !== undefined) {
    console.error(foregroundRunRefusalMessages[refusal]);
    process.exitCode = 2;
    return;
  }
  const entrypoints = { daemon: packageEntrypointPath("sessiond"), web: packageEntrypointPath("server") };
  const missing = [entrypoints.daemon, entrypoints.web].filter((path) => !regularFileExists(path));
  if (missing.length > 0) throw new Error(`pi-web run: ${missing.join(" and ")} not found; build PI WEB first (\`pnpm run build\` in a checkout).`);
  const log = (message: string): void => { console.error(`pi-web run: ${message}`); };
  const warning = pid1Warning(process.pid);
  if (warning !== undefined) log(warning);
  process.exitCode = await runForeground({
    entrypoints,
    environment: process.env,
    isDaemonReady: () => probeRunningComponentReady("sessiond", { configEnv: process.env }),
    log,
  });
}

function help(): void {
  console.log(`PI WEB

Usage:
  pi-web install [--dev] [--host 127.0.0.1] [--port 8504] [--config ~/.config/pi-web/config.json]
  pi-web install --at-boot | --at-log-on   (Windows: start at boot, or at sign-in)
  pi-web uninstall
  pi-web start|stop|restart|status|logs
  pi-web run   (both processes in the foreground, without a service manager)
  pi-web plugins disable <plugin-id> [--config <path>] [--restart]
  pi-web plugins safe-start show|clear|set <bundled-only|none> [--config <path>] [--restart]
  pi-web doctor
  pi-web version

Recommended install:
  npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty
  pi-web install

Development service install from a checkout:
  pi-web install --dev
`);
}

async function main(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "install") await install(args);
  else if (command === "uninstall") await uninstall();
  else if (command === "run") await foregroundRun(args);
  else if (command === "start" || command === "restart" || command === "doctor" || command === "version") {
    await runReadinessCliCommand(command, readinessCliCommandDependencies());
  } else if (command === "stop" || command === "status") await serviceAction(command);
  else if (command === "logs") logs();
  else if (command === "plugins") runPluginRecoveryCli(args, { restartPlan: (context) => sessionDaemonRestartPlan(context) });
  else if (command === "--version" || command === "-v") console.log(packageVersion());
  else if (command === "help" || command === "--help" || command === "-h") help();
  else throw new Error(`Unknown command: ${command}`);
}

export function isCliEntrypoint(entrypoint: string | undefined = process.argv[1], modulePath: string = fileURLToPath(import.meta.url)): boolean {
  if (entrypoint === undefined) return false;
  if (entrypoint === modulePath) return true;
  try {
    return realpathSync(entrypoint) === realpathSync(modulePath);
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
