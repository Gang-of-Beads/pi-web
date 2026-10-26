import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LifecycleServiceRef, ServiceActionDeps, ServiceLifecycleAction } from "./serviceAction.js";
import type {
  NativeServicePlan,
  NativeServicePlanService,
  NativeServicePrerequisite,
  NativeServiceRestartPolicy,
  NativeServiceShell,
} from "./servicePlan.js";
import { nodeVersionCheckScript, packageScriptsCheckScript } from "./serviceProbe.js";
import { xmlEscape } from "./serviceRendering.js";

/**
 * Windows backend: one per-user Scheduled Task per service, started at log-on or, when installed
 * with `--at-boot`, at boot (see WindowsTaskStartMode).
 *
 * Each task runs `conhost.exe --headless powershell.exe -File <launcher>`. The headless console host
 * is what keeps a console program from opening a window in the user's session; Task Scheduler's own
 * "hidden" flag only hides the task from its UI. The launcher (a PowerShell file PI WEB writes, the
 * Windows counterpart of a unit file or plist) sets the service environment, runs the service command
 * line through cmd.exe, appends its output to the data directory's log file, restarts it two seconds
 * after a failure, and kills the command's process tree if its console host goes away while it runs.
 * `Stop-ScheduledTask` ends the console host and the launcher together, too fast for that watch, and
 * not the command's cmd.exe and node: stopping a service is therefore windowsTaskStopScript's job.
 *
 * Output goes through a FileStream opened for append-only writes with read, write and delete sharing,
 * so the process's own log retention can truncate the file and `pi-web logs` can read it while the
 * service writes. cmd.exe's `>>` redirection opens the file exclusively and would block both. After
 * the command exits the launcher waits at most five seconds for each of its output copies, because a
 * process the service started can still hold the output pipe and would otherwise hold back the restart.
 *
 * A task inherits the environment of a fresh log-on (the user's and the machine's environment
 * variables), not the installing shell's; that is this backend's counterpart of the login-shell rule.
 */

export const windowsTaskServiceShell: NativeServiceShell = {
  name: "cmd",
  executable: "cmd.exe",
  source: "detected",
  detectedExecutable: "cmd.exe",
};

export const windowsPowerShell = "powershell.exe";

/**
 * When PI WEB's tasks start, and so in which context they run.
 *
 * - `log-on`: at the user's log-on, in the signed-in session (InteractiveToken). No administrator
 *   rights are needed, and nothing runs while the user is signed out.
 * - `at-boot`: at boot, as the user without a stored password (S4U), whether or not anyone is signed
 *   in; the Windows counterpart of systemd's lingering. Registering such a task needs an elevated
 *   token, and its logon needs the "Log on as a batch job" right. It runs non-interactively, with no
 *   network credentials (no mapped drives or SMB shares as the user).
 *
 * Every task PI WEB registers in a mode uses that mode's principal, the service-manager probe and
 * the hand-off tasks included, so each runs in the context the services get.
 */
export type WindowsTaskStartMode = "log-on" | "at-boot";

/**
 * The start mode the installed session daemon launcher records. A launcher that recognizably
 * predates the mode line is `log-on`, the only mode there was; one PI WEB cannot read is `unreadable`.
 */
export type InstalledWindowsTaskStartMode = WindowsTaskStartMode | "not-installed" | "unreadable";

const windowsTaskStartModes: readonly WindowsTaskStartMode[] = ["log-on", "at-boot"];

/**
 * The mode the installed tasks keep working in: the restart and uninstall hand-offs and doctor's
 * probe. Nothing installed and an unreadable launcher get today's log-on behaviour; `pi-web install`
 * refuses an unreadable one on its own (windowsInstallStartMode), and doctor reports it through its
 * definition inspection before any probe runs.
 */
export const windowsTaskStartModeInUse: Readonly<Record<InstalledWindowsTaskStartMode, WindowsTaskStartMode>> = {
  "log-on": "log-on",
  "at-boot": "at-boot",
  "not-installed": "log-on",
  unreadable: "log-on",
};

const installedStartModeKeptByInstall: Readonly<Record<InstalledWindowsTaskStartMode, WindowsTaskStartMode | undefined>> = {
  "log-on": "log-on",
  "at-boot": "at-boot",
  "not-installed": "log-on",
  unreadable: undefined,
};

/**
 * The mode `pi-web install` registers: the one asked for, otherwise the installed one, otherwise
 * log-on. Undefined when nothing was asked for and the installed mode cannot be read.
 */
export function windowsInstallStartMode(
  requested: WindowsTaskStartMode | undefined,
  installed: InstalledWindowsTaskStartMode,
): WindowsTaskStartMode | undefined {
  return requested ?? installedStartModeKeptByInstall[installed];
}

/** Read the start mode a launcher records; a missing file is `not-installed`. */
export function readInstalledWindowsTaskStartMode(launcherPath: string): InstalledWindowsTaskStartMode {
  let contents: string;
  try {
    contents = readFileSync(launcherPath, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "not-installed";
    return "unreadable";
  }
  return parseWindowsTaskLauncher(contents)?.startMode ?? "unreadable";
}

/** The CLI commands a transient task runs for a command that cannot run inside the session daemon. */
export type WindowsCliHandOffVerb = "restart" | "uninstall";

export const windowsCliHandOffVerbs: readonly WindowsCliHandOffVerb[] = ["restart", "uninstall"];

const taskNameForbiddenCharacters = /[\\/:*?"<>|]/u;

/**
 * A PI WEB task's name for one Windows user. The tasks sit at the root of the Task Scheduler
 * library, where a standard user can register them, and that library is machine-wide: without the
 * user name a second user's install would replace the first user's tasks. A name Task Scheduler
 * cannot hold is refused rather than altered.
 */
export function windowsUserTaskName(baseName: string, userName: string): string {
  if (userName.trim() === "" || taskNameForbiddenCharacters.test(userName)) {
    throw new Error(`Cannot name a scheduled task after the Windows user ${JSON.stringify(userName)}: task names cannot contain \\ / : * ? " < > |.`);
  }
  return `${baseName} (${userName})`;
}

export function windowsCliHandOffTaskName(verb: WindowsCliHandOffVerb, userName: string): string {
  return windowsUserTaskName(`PI WEB ${verb}`, userName);
}

/** Where the service launchers live: per user, under the local application data folder. */
export function windowsLauncherDirectory(env: Readonly<Record<string, string | undefined>>, home: string): string {
  return join(env["LOCALAPPDATA"] ?? join(home, "AppData", "Local"), "pi-web", "services");
}

const environmentKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const powerShellQuoteCharacters = "'\u2018\u2019\u201A\u201B";
const powerShellLiteralBody = `(?:[^${powerShellQuoteCharacters}]|(?<quote>[${powerShellQuoteCharacters}])\\k<quote>)*`;

/**
 * Arguments for one non-interactive Windows PowerShell 5.1 script whose output is UTF-8. Progress
 * records are off because a redirected stderr receives them as CLIXML. The script exits 0 unless it
 * exits itself or stops on an error: an error it caught would otherwise still leave `$?` false, and
 * PowerShell would report exit status 1.
 */
export function windowsPowerShellArguments(script: string): string[] {
  const source = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$ProgressPreference = 'SilentlyContinue'\n${script}\nexit 0`;
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(source, "utf16le").toString("base64")];
}

/** A single-quoted PowerShell literal; PowerShell also treats the typographic single quotes as quotes. */
export function powerShellLiteral(value: string): string {
  return `'${value.replace(new RegExp(`[${powerShellQuoteCharacters}]`, "gu"), "$&$&")}'`;
}

function powerShellLiteralValue(body: string): string {
  return body.replace(new RegExp(`([${powerShellQuoteCharacters}])\\1`, "gu"), "$1");
}

export interface WindowsTaskDefinition {
  description: string;
  userSid: string;
  startMode: WindowsTaskStartMode;
  /** Whether the mode's trigger starts the task; a task without one runs only when started. */
  startsAutomatically: boolean;
  powerShellArguments: string;
  executionTimeLimit: string;
  restartOnFailure: boolean;
}

/**
 * The task definition Task Scheduler registers. The security descriptor grants the user full access
 * to the task: without it a task registered from an elevated PowerShell can still be started and
 * stopped from an ordinary one (or a PI WEB terminal), but not registered again or removed, and a
 * task cannot remove itself.
 */
export function renderWindowsTaskXml(task: WindowsTaskDefinition): string {
  const userId = xmlEscape(task.userSid);
  const trigger = task.startsAutomatically
    ? `  <Triggers>\n${windowsTaskTriggers[task.startMode](userId)}  </Triggers>\n`
    : "";
  const restart = task.restartOnFailure
    ? "    <RestartOnFailure>\n      <Interval>PT1M</Interval>\n      <Count>3</Count>\n    </RestartOnFailure>\n"
    : "";
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xmlEscape(task.description)}</Description>
    <SecurityDescriptor>D:(A;;FA;;;BA)(A;;FA;;;SY)(A;;FA;;;${userId})</SecurityDescriptor>
  </RegistrationInfo>
${trigger}  <Principals>
    <Principal id="Author">
      <UserId>${userId}</UserId>
      <LogonType>${windowsTaskLogonTypes[task.startMode]}</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>${task.executionTimeLimit}</ExecutionTimeLimit>
    <Priority>5</Priority>
${restart}  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>conhost.exe</Command>
      <Arguments>${xmlEscape(`--headless ${windowsPowerShell} ${task.powerShellArguments}`)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

const windowsTaskTriggers: Readonly<Record<WindowsTaskStartMode, (userId: string) => string>> = {
  "log-on": (userId) => `    <LogonTrigger>\n      <Enabled>true</Enabled>\n      <UserId>${userId}</UserId>\n    </LogonTrigger>\n`,
  "at-boot": () => "    <BootTrigger>\n      <Enabled>true</Enabled>\n    </BootTrigger>\n",
};

const windowsTaskLogonTypes: Readonly<Record<WindowsTaskStartMode, string>> = {
  "log-on": "InteractiveToken",
  "at-boot": "S4U",
};

function powerShellFileArguments(path: string): string {
  return `-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${path}"`;
}

export function windowsServiceTaskDefinition(
  plan: NativeServicePlan,
  service: NativeServicePlanService,
  launcherPath: string,
  userSid: string,
  startMode: WindowsTaskStartMode,
): WindowsTaskDefinition {
  assertWindowsPlanService(plan, service);
  return {
    description: service.description,
    userSid,
    startMode,
    startsAutomatically: true,
    powerShellArguments: powerShellFileArguments(launcherPath),
    executionTimeLimit: "PT0S",
    restartOnFailure: service.restart === "on-failure",
  };
}

const launcherRestartFlag: Readonly<Record<NativeServiceRestartPolicy, string>> = {
  "on-failure": "$true",
  never: "$false",
};

const launcherBody = `$ErrorActionPreference = 'Stop'
$console = Get-Process -Id (Get-CimInstance Win32_Process -Filter "ProcessId = $PID").ParentProcessId
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($logPath)) | Out-Null
while ($true) {
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = 'cmd.exe'
  $start.Arguments = '/d /s /c "' + $commandLine + '"'
  $start.UseShellExecute = $false
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($start)
  $copies = foreach ($stream in $process.StandardOutput.BaseStream, $process.StandardError.BaseStream) {
    $log = New-Object System.IO.FileStream($logPath, [System.IO.FileMode]::Append, [System.Security.AccessControl.FileSystemRights]::AppendData, [System.IO.FileShare]'ReadWrite, Delete', 1, [System.IO.FileOptions]::None)
    [pscustomobject]@{ Log = $log; Copy = $stream.CopyToAsync($log) }
  }
  while (-not $process.WaitForExit(1000)) {
    if ($console.HasExited) {
      & taskkill.exe /PID $process.Id /T /F | Out-Null
      exit 1
    }
  }
  foreach ($copy in $copies) { $copy.Copy.Wait(5000) | Out-Null; $copy.Log.Dispose() }
  if ($process.ExitCode -eq 0 -or -not $restartOnFailure -or $console.HasExited) { exit $process.ExitCode }
  Start-Sleep -Seconds 2
}
`;

/**
 * The launcher file a service task runs. It is written with a byte-order mark because Windows
 * PowerShell 5.1 reads a file without one in the legacy ANSI code page, which would garble a
 * non-ASCII user or path name. Its second line records the task's start mode for PI WEB to read back.
 */
export function renderWindowsTaskLauncher(
  plan: NativeServicePlan,
  service: NativeServicePlanService,
  logPath: string,
  taskName: string,
  startMode: WindowsTaskStartMode,
): string {
  assertWindowsPlanService(plan, service);
  const environment = Object.entries(service.environment).map(([key, value]) => {
    if (!environmentKeyPattern.test(key)) throw new Error(`Cannot write environment variable ${JSON.stringify(key)} into a Windows task launcher.`);
    return `$env:${key} = ${powerShellLiteral(value)}\n`;
  }).join("");
  const workingDirectory = service.workingDirectory === null ? "" : `Set-Location -LiteralPath ${powerShellLiteral(service.workingDirectory)}\n`;
  return `\uFEFF# ${service.description}: run by the scheduled task "${taskName}". \`pi-web install\` writes this file and \`pi-web uninstall\` removes it.
${launcherStartModePrefix}${startMode}
${environment}${workingDirectory}$commandLine = ${powerShellLiteral(service.shellCommand)}
$logPath = ${powerShellLiteral(logPath)}
$restartOnFailure = ${launcherRestartFlag[service.restart]}
${launcherBody}`;
}

const launcherStartModePrefix = "# Start mode: ";

export interface ParsedWindowsTaskLauncher {
  startMode: WindowsTaskStartMode;
  environment: Readonly<Record<string, string>>;
  workingDirectory: string | null;
  commandLine: string;
}

/**
 * Read back the settings of a launcher `renderWindowsTaskLauncher` wrote. Anything other than the
 * rendered shape is refused rather than guessed at, as the unit and plist readers do. A launcher
 * without the start-mode line was written before `--at-boot` existed, so its task starts at log-on.
 */
export function parseWindowsTaskLauncher(contents: string): ParsedWindowsTaskLauncher | undefined {
  const lines = contents.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  if (!(lines[0] ?? "").startsWith("# ")) return undefined;
  const environment = new Map<string, string>();
  let index = 1;
  let startMode: WindowsTaskStartMode = "log-on";
  const startModeLine = lines[index] ?? "";
  if (startModeLine.startsWith(launcherStartModePrefix)) {
    const recorded = windowsTaskStartModes.find((mode) => startModeLine === `${launcherStartModePrefix}${mode}`);
    if (recorded === undefined) return undefined;
    startMode = recorded;
    index += 1;
  }
  const environmentLine = new RegExp(`^\\$env:([A-Za-z_][A-Za-z0-9_]*) = '(${powerShellLiteralBody})'$`, "u");
  for (let match = environmentLine.exec(lines[index] ?? ""); match !== null; match = environmentLine.exec(lines[index] ?? "")) {
    const key = match[1] ?? "";
    if (environment.has(key)) return undefined;
    environment.set(key, powerShellLiteralValue(match[2] ?? ""));
    index += 1;
  }
  const location = new RegExp(`^Set-Location -LiteralPath '(${powerShellLiteralBody})'$`, "u").exec(lines[index] ?? "");
  if (location !== null) index += 1;
  const command = new RegExp(`^\\$commandLine = '(${powerShellLiteralBody})'$`, "u").exec(lines[index] ?? "");
  if (command === null) return undefined;
  if (!new RegExp(`^\\$logPath = '${powerShellLiteralBody}'$`, "u").test(lines[index + 1] ?? "")) return undefined;
  return {
    startMode,
    environment: Object.fromEntries(environment),
    workingDirectory: location === null ? null : powerShellLiteralValue(location[1] ?? ""),
    commandLine: powerShellLiteralValue(command[1] ?? ""),
  };
}

export interface WindowsTaskRegistration {
  name: string;
  xml: string;
}

export interface WindowsTaskLauncherRef {
  name: string;
  launcherPath: string;
}

export function windowsTaskRegisterScript(tasks: readonly WindowsTaskRegistration[]): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    ...tasks.map((task) => `Register-ScheduledTask -TaskPath '\\' -TaskName ${powerShellLiteral(task.name)} -Xml ${powerShellLiteral(task.xml)} -Force | Out-Null`),
  ].join("\n");
}

export function windowsTaskStartScript(names: readonly string[]): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    ...names.map((name) => `Start-ScheduledTask -TaskPath '\\' -TaskName ${powerShellLiteral(name)}`),
  ].join("\n");
}

/**
 * Stop each task and kill what its launcher started. Task Scheduler ends the console host and the
 * launcher together, about a second after `Stop-ScheduledTask`, before the launcher's own watch can
 * kill the service (seen on hxd-pc-windows: cmd.exe and node outlived the stop, and the orphaned
 * session daemon kept the data directory, so every restart crash-looped). So the launcher's process
 * tree is recorded before the stop; once the launcher is gone, or after fifteen seconds, the tree is
 * grown again from that record through parent ids, which outlive the parent, so a command the launcher
 * restarted during the stop is caught too, and whatever of it is alive is killed. A process counts as
 * the same only with the same creation time, and a child only when it is younger than its parent, so a
 * reused process id is never killed. A task that is not registered is already stopped.
 */
export function windowsTaskStopScript(tasks: readonly WindowsTaskLauncherRef[]): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "function Get-PiWebLaunchers([string]$Launcher) {",
    "  @(Get-CimInstance Win32_Process -Filter \"Name = 'powershell.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Launcher) })",
    "}",
    "function Get-PiWebTree([object[]]$Seeds) {",
    "  $all = @(Get-CimInstance Win32_Process)",
    "  $tree = @($Seeds | Where-Object { $_ })",
    "  for ($i = 0; $i -lt $tree.Count; $i++) {",
    "    $parent = $tree[$i]",
    "    $tree += @($all | Where-Object { $_.ParentProcessId -eq $parent.ProcessId -and $_.CreationDate -ge $parent.CreationDate -and $tree.ProcessId -notcontains $_.ProcessId })",
    "  }",
    "  $tree",
    "}",
    "function Stop-PiWebTask([string]$Name, [string]$Launcher) {",
    "  if (-not $Launcher) { throw 'A launcher path is required to stop a PI WEB task.' }",
    "  $recorded = @(Get-PiWebTree (Get-PiWebLaunchers $Launcher))",
    "  try { Stop-ScheduledTask -TaskPath '\\' -TaskName $Name } catch { if ($_.CategoryInfo.Category -ne 'ObjectNotFound') { throw } }",
    "  $deadline = (Get-Date).AddSeconds(15)",
    "  while ((Get-Date) -lt $deadline -and (Get-PiWebLaunchers $Launcher).Count -gt 0) { Start-Sleep -Milliseconds 250 }",
    "  foreach ($process in Get-PiWebTree (@(Get-PiWebLaunchers $Launcher) + $recorded)) {",
    "    $live = Get-CimInstance Win32_Process -Filter \"ProcessId = $($process.ProcessId)\"",
    "    if ($live -and $live.CreationDate -eq $process.CreationDate) { & taskkill.exe /PID $process.ProcessId /T /F | Out-Null }",
    "  }",
    "}",
    ...tasks.map((task) => `Stop-PiWebTask ${powerShellLiteral(task.name)} ${powerShellLiteral(task.launcherPath)}`),
  ].join("\n");
}

export function windowsTaskUnregisterScript(tasks: readonly WindowsTaskLauncherRef[]): string {
  return [
    windowsTaskStopScript(tasks),
    ...tasks.map((task) => `try { Unregister-ScheduledTask -TaskPath '\\' -TaskName ${powerShellLiteral(task.name)} -Confirm:$false } catch { if ($_.CategoryInfo.Category -ne 'ObjectNotFound') { throw } }`),
  ].join("\n");
}

/**
 * Remove the named tasks that are registered and not running: a hand-off task left behind by a
 * failed run. A running one is left to finish and remove itself; that includes the uninstall
 * hand-off task this script may run in.
 */
export function windowsIdleTaskUnregisterScript(names: readonly string[]): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `foreach ($name in @(${names.map(powerShellLiteral).join(", ")})) {`,
    "  try { $task = Get-ScheduledTask -TaskPath '\\' -TaskName $name } catch { if ($_.CategoryInfo.Category -ne 'ObjectNotFound') { throw }; continue }",
    "  if ($task.State -ne 'Running') { Unregister-ScheduledTask -TaskPath '\\' -TaskName $name -Confirm:$false }",
    "}",
  ].join("\n");
}

/** Every hand-off task of this user, for `pi-web uninstall` to remove what a failed run left behind. */
export function windowsCliHandOffTaskNames(userName: string): string[] {
  return windowsCliHandOffVerbs.map((verb) => windowsCliHandOffTaskName(verb, userName));
}

export function windowsTaskQueryScript(names: readonly string[]): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `foreach ($name in @(${names.map(powerShellLiteral).join(", ")})) {`,
    "  try {",
    "    $task = Get-ScheduledTask -TaskPath '\\' -TaskName $name",
    "    $info = $task | Get-ScheduledTaskInfo",
    "    \"$name`t$($task.State)`t$($info.LastTaskResult)\"",
    "  } catch {",
    "    if ($_.CategoryInfo.Category -ne 'ObjectNotFound') { throw }",
    "    \"$name`tNotRegistered`t\"",
    "  }",
    "}",
  ].join("\n");
}

export type WindowsTaskState = "Running" | "Ready" | "Queued" | "Disabled" | "NotRegistered" | "Unknown";

export interface WindowsTaskStatus {
  state: WindowsTaskState;
  lastResult: number | undefined;
}

const windowsTaskStates: readonly WindowsTaskState[] = ["Running", "Ready", "Queued", "Disabled", "NotRegistered", "Unknown"];

/** The reported state of one task; a name missing from the output, or an unrecognized state, is Unknown. */
export function parseWindowsTaskQuery(output: string, name: string): WindowsTaskStatus {
  const fields = output.split(/\r?\n/u).map((line) => line.split("\t")).find((candidate) => candidate[0] === name);
  const state = windowsTaskStates.find((candidate) => candidate === fields?.[1]) ?? "Unknown";
  const lastResult = fields?.[2] === undefined || fields[2].trim() === "" ? undefined : Number(fields[2]);
  return { state, lastResult: lastResult === undefined || Number.isNaN(lastResult) ? undefined : lastResult };
}

export type WindowsTaskHealth = "running" | "stopped" | "unknown";

export const windowsTaskHealth: Readonly<Record<WindowsTaskState, WindowsTaskHealth>> = {
  Running: "running",
  Ready: "stopped",
  Disabled: "stopped",
  NotRegistered: "stopped",
  Queued: "unknown",
  Unknown: "unknown",
};

const windowsTaskStateDetail: Readonly<Record<WindowsTaskState, (status: WindowsTaskStatus) => string>> = {
  Running: () => "running",
  Ready: (status) => status.lastResult === undefined ? "registered, not running" : `registered, not running (last result 0x${status.lastResult.toString(16)})`,
  Disabled: () => "registered, disabled",
  NotRegistered: () => "launcher installed, scheduled task not registered",
  Queued: () => "queued",
  Unknown: () => "unknown",
};

export function windowsTaskDetail(status: WindowsTaskStatus): string {
  return windowsTaskStateDetail[status.state](status);
}

export interface WindowsTaskServiceContext {
  launcherPath(ref: LifecycleServiceRef): string;
  taskName(ref: LifecycleServiceRef): string;
}

const windowsTaskActionScripts: Readonly<Record<ServiceLifecycleAction, (refs: readonly LifecycleServiceRef[], context: WindowsTaskServiceContext) => string>> = {
  start: (refs, context) => windowsTaskStartScript(refs.map((ref) => context.taskName(ref))),
  stop: (refs, context) => windowsTaskStopScript(refs.map((ref) => launcherRef(ref, context))),
  restart: (refs, context) => refs.map((ref) => [
    windowsTaskStopScript([launcherRef(ref, context)]),
    windowsTaskStartScript([context.taskName(ref)]),
  ].join("\n")).join("\n"),
};

/**
 * Start, stop or restart the tasks in the order given. A restart finishes each task (stop, wait for
 * the launcher to exit, start) before the next one, as the launchd backend does.
 */
export function performWindowsTaskAction(
  action: ServiceLifecycleAction,
  refs: readonly LifecycleServiceRef[],
  context: WindowsTaskServiceContext,
  deps: Pick<ServiceActionDeps, "run">,
): void {
  const status = deps.run(windowsPowerShell, windowsPowerShellArguments(windowsTaskActionScripts[action](refs, context)));
  if (status !== 0) {
    throw new Error(`Task Scheduler could not ${action} ${refs.map((ref) => `"${context.taskName(ref)}"`).join(", ")} (PowerShell exit status ${String(status)}).`);
  }
}

function launcherRef(ref: LifecycleServiceRef, context: WindowsTaskServiceContext): WindowsTaskLauncherRef {
  return { name: context.taskName(ref), launcherPath: context.launcherPath(ref) };
}

export interface WindowsCliHandOffInput {
  verb: WindowsCliHandOffVerb;
  cliPath: string;
  userName: string;
  userSid: string;
  logPath: string;
}

/**
 * Whether a hand-off task unregisters itself once its command has finished. A log-on mode task is
 * transient. An at-boot mode task is registered by the elevated `pi-web install` that registers
 * the services, so a hand-off only starts it; the restart task stays for the next restart, and the
 * uninstall task goes with the services it removes.
 */
const windowsCliHandOffRemovesItself: Readonly<Record<WindowsTaskStartMode, Readonly<Record<WindowsCliHandOffVerb, boolean>>>> = {
  "log-on": { restart: true, uninstall: true },
  "at-boot": { restart: false, uninstall: true },
};

function windowsCliHandOffTask(input: WindowsCliHandOffInput, startMode: WindowsTaskStartMode): WindowsTaskRegistration {
  const taskName = windowsCliHandOffTaskName(input.verb, input.userName);
  const run = `Start-Process -FilePath 'cmd.exe' -ArgumentList ${powerShellLiteral(`/d /s /c "${windowsCliCommandLine(input.cliPath, input.verb)} >> "${input.logPath}" 2>&1"`)} -NoNewWindow -Wait`;
  const command = windowsCliHandOffRemovesItself[startMode][input.verb]
    ? ["try {", `  ${run}`, "} finally {", `  ${windowsUnregisterTaskCommand(taskName)}`, "}"].join("\n")
    : run;
  return {
    name: taskName,
    xml: renderWindowsTaskXml({
      description: `PI WEB ${input.verb} handed off from a PI WEB terminal`,
      userSid: input.userSid,
      startMode,
      startsAutomatically: false,
      powerShellArguments: windowsPowerShellArguments(command).join(" "),
      executionTimeLimit: "PT10M",
      restartOnFailure: false,
    }),
  };
}

function windowsUnregisterTaskCommand(taskName: string): string {
  return `Unregister-ScheduledTask -TaskPath '\\' -TaskName ${powerShellLiteral(taskName)} -Confirm:$false`;
}

const windowsCliHandOffScripts: Readonly<Record<WindowsTaskStartMode, (input: WindowsCliHandOffInput) => string>> = {
  "log-on": (input) => {
    const task = windowsCliHandOffTask(input, "log-on");
    return [
      windowsTaskRegisterScript([task]),
      `try { Start-ScheduledTask -TaskPath '\\' -TaskName ${powerShellLiteral(task.name)} } catch { ${windowsUnregisterTaskCommand(task.name)}; throw }`,
    ].join("\n");
  },
  "at-boot": (input) => {
    const taskName = windowsCliHandOffTaskName(input.verb, input.userName);
    const missing = `The scheduled task "${taskName}" that runs \`pi-web ${input.verb}\` from outside PI WEB is not registered. Run \`pi-web install\` from PowerShell opened as administrator to register it again, or run \`pi-web ${input.verb}\` there.`;
    return [
      "$ErrorActionPreference = 'Stop'",
      `try { Get-ScheduledTask -TaskPath '\\' -TaskName ${powerShellLiteral(taskName)} | Out-Null } catch { if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { throw ${powerShellLiteral(missing)} }; throw }`,
      `Start-ScheduledTask -TaskPath '\\' -TaskName ${powerShellLiteral(taskName)}`,
    ].join("\n");
  },
};

/**
 * Hand a CLI command to a hand-off task. A `pi-web restart` or `pi-web uninstall` started from a
 * PI WEB terminal runs inside the session daemon's process tree, so stopping that task kills the
 * command before it has finished: a restart before it starts the task again, an uninstall before it
 * unregisters anything. The hand-off task runs the same CLI from outside that tree, in a fresh
 * log-on environment (so it does the work itself instead of handing it off again), in the context
 * of the installed start mode, and appends its output to `logPath`. In log-on mode it is registered
 * here and unregisters itself when the command has finished, and a task that cannot be started is
 * unregistered at once, so a failed hand-off leaves nothing behind. In at-boot mode it was
 * registered by `pi-web install` (windowsCliHandOffRegisterScript) and is only started here.
 */
export function windowsCliHandOffScript(input: WindowsCliHandOffInput & { startMode: WindowsTaskStartMode }): string {
  return windowsCliHandOffScripts[input.startMode](input);
}

/** Register the at-boot mode hand-off tasks, one per verb, for windowsCliHandOffScript to start. */
export function windowsCliHandOffRegisterScript(inputs: readonly WindowsCliHandOffInput[]): string {
  return windowsTaskRegisterScript(inputs.map((input) => windowsCliHandOffTask(input, "at-boot")));
}

/**
 * The command line the hand-off task runs: this Node.js running the given CLI file, so the command
 * uses the build of the package that asked for it rather than whichever `pi-web` PATH finds.
 */
function windowsCliCommandLine(cliPath: string, verb: WindowsCliHandOffVerb): string {
  return `${[process.execPath, ...process.execArgv, cliPath].map((part) => `"${part}"`).join(" ")} ${verb}`;
}

/**
 * A PowerShell expression that is `$true` exactly when the prerequisite holds. The node scripts
 * travel in an environment variable because Windows PowerShell 5.1 does not escape double quotes
 * inside arguments it passes to a native program.
 */
export function windowsPrerequisiteCheck(prerequisite: NativeServicePrerequisite): string {
  switch (prerequisite.kind) {
    case "command-available":
      return `[bool](Get-Command -Name ${powerShellLiteral(prerequisite.command)} -CommandType Application -ErrorAction SilentlyContinue)`;
    case "node-version":
      return nodeScriptCheck(nodeVersionCheckScript(prerequisite.minimumVersion), []);
    case "readable-file":
      return `& { try { [System.IO.File]::OpenRead(${powerShellLiteral(prerequisite.path)}).Dispose(); $true } catch { $false } }`;
    case "package-scripts":
      return nodeScriptCheck(packageScriptsCheckScript, [prerequisite.packageJsonPath, ...prerequisite.scripts]);
  }
}

function nodeScriptCheck(script: string, arguments_: readonly string[]): string {
  const extra = arguments_.map((argument) => ` ${powerShellLiteral(argument)}`).join("");
  return `& { $node = Get-Command -Name 'node' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $node) { return $false }; $env:PI_WEB_PROBE_SCRIPT = ${powerShellLiteral(script)}; & $node.Source -e 'eval(process.env.PI_WEB_PROBE_SCRIPT)'${extra} *> $null; $LASTEXITCODE -eq 0 }`;
}

/** The caller's own view of a command: its path and, when asked, its version output. */
export function windowsCallerCommandScript(command: string, printVersion: boolean): string {
  return [
    "$ErrorActionPreference = 'Continue'",
    `$command = Get-Command -Name ${powerShellLiteral(command)} -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1`,
    "if (-not $command) { exit 1 }",
    "$command.Source",
    ...(printVersion ? ["& $command.Source --version 2>&1 | ForEach-Object { \"$_\" }"] : []),
    "exit 0",
  ].join("\n");
}

export function windowsCallerNodeVersionScript(minimumVersion: string): string {
  return [
    "$ErrorActionPreference = 'Continue'",
    "$node = Get-Command -Name 'node' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (-not $node) { exit 1 }",
    `$env:PI_WEB_PROBE_SCRIPT = ${powerShellLiteral(nodeVersionCheckScript(minimumVersion))}`,
    "& $node.Source -e 'eval(process.env.PI_WEB_PROBE_SCRIPT)'",
    "exit $LASTEXITCODE",
  ].join("\n");
}

export function windowsCallerPrerequisiteScript(prerequisite: NativeServicePrerequisite): string {
  return `$ErrorActionPreference = 'Continue'\nif (${windowsPrerequisiteCheck(prerequisite)}) { exit 0 } else { exit 1 }`;
}

/**
 * Whether the caller can register and run the tasks of a start mode. A log-on mode task runs only
 * in a session the user is signed in to (at the console or over Remote Desktop, connected or not);
 * an SSH session is not one, and every process of a signed-in user's session runs in a session
 * other than 0. An at-boot mode task can only be registered from an elevated token.
 */
export type WindowsTaskContext = "ready" | "nobody-signed-in" | "not-elevated";

const windowsTaskContexts: readonly WindowsTaskContext[] = ["ready", "nobody-signed-in", "not-elevated"];

const windowsTaskContextScripts: Readonly<Record<WindowsTaskStartMode, string>> = {
  "log-on": [
    "$ErrorActionPreference = 'Stop'",
    "$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "foreach ($process in @(Get-CimInstance Win32_Process -Filter 'SessionId <> 0')) {",
    "  $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction SilentlyContinue",
    "  if ($owner -and $owner.Sid -eq $sid) { 'ready'; exit 0 }",
    "}",
    "'nobody-signed-in'",
  ].join("\n"),
  "at-boot": [
    "$ErrorActionPreference = 'Stop'",
    "$principal = New-Object System.Security.Principal.WindowsPrincipal([System.Security.Principal.WindowsIdentity]::GetCurrent())",
    "if ($principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) { 'ready' } else { 'not-elevated' }",
  ].join("\n"),
};

export function windowsTaskContextScript(startMode: WindowsTaskStartMode): string {
  return windowsTaskContextScripts[startMode];
}

/** The context windowsTaskContextScript reported; undefined when its output is not one. */
export function parseWindowsTaskContext(output: string): WindowsTaskContext | undefined {
  const reported = output.trim();
  return windowsTaskContexts.find((context) => context === reported);
}

/**
 * Whether this shell can stop, start, restart, reinstall or remove the installed tasks: the two
 * refusals differ in whether the installed tasks are known to start at boot or may do so.
 */
export type WindowsServiceManagementAccess = "ok" | "at-boot-elevation-required" | "unreadable-elevation-required";

const windowsServiceManagementAccessWithoutElevation: Readonly<Record<InstalledWindowsTaskStartMode, WindowsServiceManagementAccess>> = {
  "log-on": "ok",
  "at-boot": "at-boot-elevation-required",
  "not-installed": "ok",
  unreadable: "unreadable-elevation-required",
};

/**
 * At-boot tasks are installed from an administrator account and log on as S4U, which gets that
 * account's full, unfiltered token even with LeastPrivilege. A shell with the account's filtered
 * token can then neither end their processes nor replace them cleanly: a non-elevated
 * `pi-web restart` left high-integrity processes behind that the next daemon collided with. An
 * at-boot install, or one whose launcher cannot be read and so may be one, needs the caller's
 * elevation, so `atBootShellContext` (the at-boot windowsTaskContext) is read only then; a check that
 * failed (undefined) keeps the old behaviour.
 */
export function windowsServiceManagementAccess(
  installed: InstalledWindowsTaskStartMode,
  atBootShellContext: () => WindowsTaskContext | undefined,
): WindowsServiceManagementAccess {
  const withoutElevation = windowsServiceManagementAccessWithoutElevation[installed];
  return withoutElevation !== "ok" && atBootShellContext() === "not-elevated" ? withoutElevation : "ok";
}

/** The user's SID from `whoami /user /fo csv /nh`; the user name there can be a stale or workgroup alias. */
export function windowsUserSidFromWhoami(output: string): string | undefined {
  return /"(S-1-\d+(?:-\d+)+)"\s*$/mu.exec(output)?.[1];
}

function assertWindowsPlanService(plan: NativeServicePlan, service: NativeServicePlanService): void {
  if (!plan.services.includes(service)) {
    throw new Error(`Cannot render ${service.id}; it is not a member of the supplied native service plan.`);
  }
  if (plan.backend.kind !== "windows") {
    throw new Error(`Cannot render a Windows task from a ${plan.backend.kind} native service plan.`);
  }
}
