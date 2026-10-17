import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorMessage } from "../shared/unknownValues.js";
import type {
  NativeServiceAuthoritativeProbe,
  NativeServicePrerequisite,
  NativeServiceProbeRequest,
  NativeServiceProbeResult,
} from "./servicePlan.js";
import { parseProbeOutput, SpawnProbeCommandRunner, type ProbeCommandResult, type ProbeCommandRunner } from "./serviceProbe.js";
import {
  powerShellLiteral,
  renderWindowsTaskXml,
  windowsPowerShell,
  windowsPowerShellArguments,
  windowsPrerequisiteCheck,
  windowsTaskRegisterScript,
  windowsTaskUnregisterScript,
  windowsUserSidFromWhoami,
  type WindowsTaskStartMode,
} from "./windowsTaskScheduler.js";

export interface WindowsTaskProbeFileSystem {
  createTemporaryDirectory(): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  readOptionalFile(path: string): Promise<string | null>;
  removeDirectory(path: string): Promise<void>;
}

export interface WindowsTaskProbeDependencies {
  /** The start mode whose principal the probe task runs with. */
  startMode: WindowsTaskStartMode;
  commandRunner: ProbeCommandRunner;
  fileSystem: WindowsTaskProbeFileSystem;
  createUniqueId(): string;
  probeTimeoutMs: number;
  commandTimeoutMs: number;
}

const probeTimedOutExitStatus = 2;
const probeTaskEndedExitStatus = 3;
const probeTaskResultPrefix = "PI_WEB_PROBE_TASK_RESULT ";

/**
 * Task Scheduler results that mean the task could not log on as the user. For an at-boot mode
 * (S4U) task that is a missing "Log on as a batch job" right.
 */
const windowsTaskLogonFailureResults: ReadonlySet<number> = new Set([0x8007052e, 0x80070569]);

const logonFailureHint: Record<WindowsTaskStartMode, string> = {
  "log-on": "",
  "at-boot": " The task logs on as you without a stored password, so your account needs the Log on as a batch job right; an administrator account has it.",
};

/**
 * Runs the prerequisites inside a temporary scheduled task, the same context a service task gets
 * (a fresh log-on environment, the headless console host, Windows PowerShell, the start mode's
 * principal). One PowerShell call registers the task, starts it, waits for its result file and
 * unregisters it; a task that ends without writing one is reported with its result at once. When
 * that call itself has to be killed, the task is unregistered separately and the probe only
 * succeeds once that has been confirmed.
 */
export class WindowsTaskNativeServiceProbe implements NativeServiceAuthoritativeProbe {
  public constructor(private readonly dependencies: WindowsTaskProbeDependencies) {}

  public async run(request: NativeServiceProbeRequest): Promise<NativeServiceProbeResult> {
    if (request.backend.kind !== "windows") {
      return infrastructureFailure("manager", `Windows task probe cannot validate the ${request.backend.kind} backend.`);
    }
    const uniqueId = this.dependencies.createUniqueId().toLowerCase().replaceAll(/[^a-z0-9-]/gu, "").slice(0, 36) || "probe";
    const taskName = `PI WEB probe ${uniqueId}`;
    const outputPrefix = `PI_WEB_PROBE_${uniqueId}`;

    const whoami = await this.dependencies.commandRunner.run("whoami.exe", ["/user", "/fo", "csv", "/nh"], this.dependencies.commandTimeoutMs);
    const userSid = whoami.kind === "completed" && whoami.status === 0 ? windowsUserSidFromWhoami(whoami.stdout) : undefined;
    if (userSid === undefined) return infrastructureFailure("manager", `Could not read the current user's SID: ${commandFailureDetail(whoami)}`);

    let directory: string | null = null;
    let result: NativeServiceProbeResult;
    let registration: "absent" | "uncertain" = "absent";
    try {
      directory = await this.dependencies.fileSystem.createTemporaryDirectory();
      const scriptPath = join(directory, "probe.ps1");
      const resultPath = join(directory, "result.log");
      await this.dependencies.fileSystem.writeFile(scriptPath, windowsProbeScript(request, outputPrefix, join(directory, "result.pending"), resultPath));
      const xml = renderWindowsTaskXml({
        description: "PI WEB service-manager probe",
        userSid,
        startMode: this.dependencies.startMode,
        startsAutomatically: false,
        powerShellArguments: `-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`,
        executionTimeLimit: "PT1M",
        restartOnFailure: false,
      });
      const run = await this.dependencies.commandRunner.run(
        windowsPowerShell,
        windowsPowerShellArguments(windowsProbeRunScript(taskName, xml, resultPath, this.dependencies.probeTimeoutMs)),
        this.dependencies.commandTimeoutMs,
      );
      if (run.kind === "completed" && run.status === 0) {
        const output = await this.dependencies.fileSystem.readOptionalFile(resultPath);
        result = output === null
          ? infrastructureFailure("malformed-output", `Windows task probe ${taskName} reported completion without a result file.`)
          : parseProbeOutput(output, request.prerequisites, outputPrefix);
      } else if (run.kind === "completed" && run.status === probeTaskEndedExitStatus) {
        result = infrastructureFailure("manager", probeTaskEndedMessage(taskName, run.stdout, this.dependencies.startMode));
      } else if (run.kind === "completed" && run.status === probeTimedOutExitStatus) {
        result = infrastructureFailure("timeout", `Timed out waiting for Windows task probe ${taskName}.`);
      } else {
        registration = run.kind === "spawn-failure" ? "absent" : "uncertain";
        result = run.kind === "timeout"
          ? infrastructureFailure("timeout", `Timed out running Windows task probe ${taskName}.`)
          : infrastructureFailure("manager", `Windows task probe ${taskName} failed: ${commandFailureDetail(run)}`);
      }
    } catch (error: unknown) {
      result = infrastructureFailure("manager", `Could not prepare Windows task probe: ${errorMessage(error)}`);
    }

    const cleanupFailures: string[] = [];
    if (registration === "uncertain" && directory !== null) {
      const cleanup = await this.dependencies.commandRunner.run(
        windowsPowerShell,
        windowsPowerShellArguments(windowsTaskUnregisterScript([{ name: taskName, launcherPath: directory }])),
        this.dependencies.commandTimeoutMs,
      );
      if (cleanup.kind !== "completed" || cleanup.status !== 0) cleanupFailures.push(`unregister failed: ${commandFailureDetail(cleanup)}`);
    }
    if (directory !== null) {
      try {
        await this.dependencies.fileSystem.removeDirectory(directory);
      } catch (error: unknown) {
        cleanupFailures.push(`temporary-file removal failed: ${errorMessage(error)}`);
      }
    }
    return cleanupFailures.length === 0
      ? result
      : infrastructureFailure("cleanup", `Windows task probe cleanup failed for ${taskName}: ${cleanupFailures.join("; ")}`);
  }
}

export function createWindowsTaskProbe(startMode: WindowsTaskStartMode): NativeServiceAuthoritativeProbe {
  return new WindowsTaskNativeServiceProbe({
    startMode,
    commandRunner: new SpawnProbeCommandRunner(),
    fileSystem: {
      createTemporaryDirectory: () => mkdtemp(join(tmpdir(), "pi-web-task-probe-")),
      writeFile: (path, contents) => writeFile(path, `\uFEFF${contents}`, "utf8"),
      readOptionalFile: async (path) => {
        try {
          return await readFile(path, "utf8");
        } catch (error: unknown) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
          throw error;
        }
      },
      removeDirectory: (path) => rm(path, { recursive: true, force: true }),
    },
    createUniqueId: randomUUID,
    probeTimeoutMs: 15_000,
    commandTimeoutMs: 45_000,
  });
}

function windowsProbeScript(
  request: NativeServiceProbeRequest,
  outputPrefix: string,
  pendingPath: string,
  resultPath: string,
): string {
  return [
    "$ErrorActionPreference = 'Continue'",
    ...Object.entries(request.environment).map(([key, value]) => `$env:${key} = ${powerShellLiteral(value)}`),
    ...(request.workingDirectory === null ? [] : [`Set-Location -LiteralPath ${powerShellLiteral(request.workingDirectory)}`]),
    "$results = New-Object System.Collections.Generic.List[string]",
    ...request.prerequisites.map((prerequisite) => probeLine(prerequisite, outputPrefix)),
    `[System.IO.File]::WriteAllLines(${powerShellLiteral(pendingPath)}, $results)`,
    `Move-Item -LiteralPath ${powerShellLiteral(pendingPath)} -Destination ${powerShellLiteral(resultPath)}`,
    "",
  ].join("\n");
}

function probeLine(prerequisite: NativeServicePrerequisite, outputPrefix: string): string {
  const marker = (status: "satisfied" | "unsatisfied"): string => powerShellLiteral([outputPrefix, Buffer.from(prerequisite.id, "utf8").toString("base64"), status].join("\t"));
  return `if (${windowsPrerequisiteCheck(prerequisite)}) { $results.Add(${marker("satisfied")}) } else { $results.Add(${marker("unsatisfied")}) }`;
}

/**
 * 267009 (0x41301) is "running" and 267011 (0x41303) "has not yet run": a task in neither state that
 * is not running has ended, and if it ended without its result file it could not run the probe.
 * Task Scheduler may not report a result, and may fail to answer for a moment: the loop then keeps
 * waiting, as it did before it watched the task.
 */
function windowsProbeRunScript(taskName: string, xml: string, resultPath: string, timeoutMs: number): string {
  const name = powerShellLiteral(taskName);
  const result = powerShellLiteral(resultPath);
  return [
    windowsTaskRegisterScript([{ name: taskName, xml }]),
    "$timedOut = $false",
    "$ended = $false",
    "$endedResult = $null",
    "try {",
    `  Start-ScheduledTask -TaskPath '\\' -TaskName ${name}`,
    `  $deadline = (Get-Date).AddMilliseconds(${String(timeoutMs)})`,
    `  while (-not (Test-Path -LiteralPath ${result})) {`,
    "    if ((Get-Date) -gt $deadline) { $timedOut = $true; break }",
    `    try { $task = Get-ScheduledTask -TaskPath '\\' -TaskName ${name} -ErrorAction Stop; $last = ($task | Get-ScheduledTaskInfo -ErrorAction Stop).LastTaskResult } catch { $task = $null }`,
    `    if ($null -ne $task -and $task.State -ne 'Running' -and $task.State -ne 'Queued' -and $last -ne 267009 -and $last -ne 267011 -and -not (Test-Path -LiteralPath ${result})) { $ended = $true; $endedResult = $last; break }`,
    "    Start-Sleep -Milliseconds 100",
    "  }",
    "} finally {",
    `  Stop-ScheduledTask -TaskPath '\\' -TaskName ${powerShellLiteral(taskName)} -ErrorAction SilentlyContinue`,
    `  Unregister-ScheduledTask -TaskPath '\\' -TaskName ${powerShellLiteral(taskName)} -Confirm:$false`,
    "}",
    `if ($timedOut) { exit ${String(probeTimedOutExitStatus)} }`,
    `if ($ended) { if ($null -eq $endedResult) { "${probeTaskResultPrefix}unknown" } else { "${probeTaskResultPrefix}$endedResult" }; exit ${String(probeTaskEndedExitStatus)} }`,
  ].join("\n");
}

function probeTaskEndedMessage(taskName: string, stdout: string, startMode: WindowsTaskStartMode): string {
  const reported = stdout.split(/\r?\n/u).find((line) => line.startsWith(probeTaskResultPrefix))?.slice(probeTaskResultPrefix.length).trim();
  const code = reported === undefined || reported === "" ? undefined : Number(reported);
  if (code === undefined || !Number.isSafeInteger(code)) return `Windows task probe ${taskName} ended without writing its result (Task Scheduler result ${reported === undefined || reported === "" ? "unknown" : reported}).`;
  const ended = `Windows task probe ${taskName} ended without writing its result (Task Scheduler result 0x${(code >>> 0).toString(16)}).`;
  return windowsTaskLogonFailureResults.has(code >>> 0) ? `${ended}${logonFailureHint[startMode]}` : ended;
}

function commandFailureDetail(result: ProbeCommandResult): string {
  if (result.kind === "timeout") return "command timed out";
  if (result.kind === "spawn-failure") return result.message;
  if (result.kind === "output-limit") return "command output exceeded the capture limit";
  const line = `${result.stderr}\n${result.stdout}`.split(/\r?\n/u).find((candidate) => candidate.trim() !== "");
  return line?.trim() ?? `exit status ${String(result.status)}`;
}

function infrastructureFailure(
  reason: "manager" | "timeout" | "malformed-output" | "cleanup",
  message: string,
): NativeServiceProbeResult {
  return { kind: "infrastructure-failure", reason, message };
}
