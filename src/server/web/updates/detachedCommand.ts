import { spawn } from "node:child_process";
import { posix as posixPath } from "node:path";
import { nativeServiceBackendKind } from "../../../nativeServices/serviceBackendKind.js";
import type { NativeServiceBackendKind } from "../../../nativeServices/servicePlan.js";
import { TERMUX_PREFIX } from "../../../nativeServices/termuxServices.js";

/** A command started in its own session, so it outlives the web process it restarts. */
export interface DetachedCommand {
  command: string;
  args: readonly string[];
  /** Names the launcher in logs when the command cannot be started. */
  launcher: string;
}

/** Termux's own bash; its `/bin/bash` exists only through termux-exec's path rewriting. */
export const termuxLoginShell = posixPath.join(TERMUX_PREFIX, "bin", "bash");

/** The service manager this web process runs under, named by the same classifier the CLI uses. */
export function currentNativeServiceBackendKind(): NativeServiceBackendKind | undefined {
  return nativeServiceBackendKind(process.platform, process.env);
}

/**
 * Start the command detached and resolve once it is running. A command that
 * cannot be started rejects with `describeFailure`'s error, so no caller can
 * report work as started when nothing ran.
 */
export function startDetachedCommand(runner: DetachedCommand, describeFailure: (error: Error) => Error): Promise<void> {
  const child = spawn(runner.command, [...runner.args], { detached: true, stdio: "ignore" });
  child.unref();
  return new Promise<void>((resolve, reject) => {
    child.once("error", (error) => { reject(describeFailure(error)); });
    child.once("spawn", () => { resolve(); });
  });
}
