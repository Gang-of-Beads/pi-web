import { spawn } from "node:child_process";
import { posix as posixPath } from "node:path";
import { nativeServiceBackendKind } from "../../../nativeServices/serviceBackendKind.js";
import type { NativeServiceBackendKind } from "../../../nativeServices/servicePlan.js";
import { TERMUX_PREFIX } from "../../../nativeServices/termuxServices.js";

/**
 * When a launched command counts as started. `running`: the command does the work itself in its
 * own session, so a successful spawn is the start. `handed-off`: the command only hands the work to
 * the service manager (a Windows scheduled task) and exits, so the start is its exit status 0.
 */
export type DetachedCommandStart = "running" | "handed-off";

/** A command whose work outlives the web process it restarts. */
export interface DetachedCommand {
  command: string;
  args: readonly string[];
  /** Names the launcher in logs when the command cannot be started. */
  launcher: string;
  /** Defaults to `running`. */
  start?: DetachedCommandStart;
}

/** Termux's own bash; its `/bin/bash` exists only through termux-exec's path rewriting. */
export const termuxLoginShell = posixPath.join(TERMUX_PREFIX, "bin", "bash");

/** The service manager this web process runs under, named by the same classifier the CLI uses. */
export function currentNativeServiceBackendKind(): NativeServiceBackendKind | undefined {
  return nativeServiceBackendKind(process.platform, process.env);
}

const detachedCommandStarters: Readonly<Record<DetachedCommandStart, (runner: DetachedCommand, describeFailure: (error: Error) => Error) => Promise<void>>> = {
  running: (runner, describeFailure) => {
    const child = spawn(runner.command, [...runner.args], { detached: true, stdio: "ignore" });
    child.unref();
    return new Promise<void>((resolve, reject) => {
      child.once("error", (error) => { reject(describeFailure(error)); });
      child.once("spawn", () => { resolve(); });
    });
  },
  "handed-off": (runner, describeFailure) => {
    const child = spawn(runner.command, [...runner.args], { stdio: "ignore", windowsHide: true });
    return new Promise<void>((resolve, reject) => {
      child.once("error", (error) => { reject(describeFailure(error)); });
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(describeFailure(new Error(`${runner.launcher} exited with ${code === null ? `signal ${String(signal)}` : `status ${String(code)}`}`)));
      });
    });
  },
};

/**
 * Start the command and resolve once it has started, as its `start` defines. A command that cannot
 * be started rejects with `describeFailure`'s error, so no caller can report work as started when
 * nothing ran.
 */
export function startDetachedCommand(runner: DetachedCommand, describeFailure: (error: Error) => Error): Promise<void> {
  return detachedCommandStarters[runner.start ?? "running"](runner, describeFailure);
}
