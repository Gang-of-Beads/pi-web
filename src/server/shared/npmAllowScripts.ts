import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Whether the npm on PATH knows the `allow-scripts` option. npm 12 skips node-pty's build unless
 * `--allow-scripts=node-pty` allows it, and npm 11.15 and later know the option. npm 11.6 to 11.14
 * warn "Unknown cli config" on every run that passes it (owner report, 2026-10-22), and npm 10
 * accepts it silently. Only `unknown` leaves the flag out. `undetermined` covers a check that was
 * not needed and one whose npm was missing, timed out or failed: neither proves anything, and npm 12
 * needs the flag.
 */
export type NpmAllowScriptsVerdict = "known" | "unknown" | "undetermined";

export const PI_WEB_PACKAGE_NAME = "@gang-of-beads/pi-web";
const PI_WEB_GLOBAL_INSTALL = `npm install -g ${PI_WEB_PACKAGE_NAME}`;
const NPM_CONFIG_TIMEOUT_MS = 5000;

const allowScriptsFlags: Readonly<Record<NpmAllowScriptsVerdict, string>> = {
  known: " --allow-scripts=node-pty",
  unknown: "",
  "undetermined": " --allow-scripts=node-pty",
};

const execFileAsync = promisify(execFile);

/** `npm config get allow-scripts` prints the value of a known option (empty by default) and `undefined` for an unknown one; both exit 0. */
function npmAllowScriptsVerdictOf(configGetOutput: string): NpmAllowScriptsVerdict {
  return configGetOutput.trim() === "undefined" ? "unknown" : "known";
}

/** The global install of PI WEB, with node-pty's install script allowed unless this npm does not know the option. */
export function piWebGlobalInstallCommand(verdict: NpmAllowScriptsVerdict): string {
  return `${PI_WEB_GLOBAL_INSTALL}${allowScriptsFlags[verdict]}`;
}

/**
 * Asks the npm on PATH each time, so an npm upgraded while PI WEB runs gets its own answer; callers
 * such as the status cache decide how often that is. npm is a `.cmd` script on Windows, which only
 * a shell can start.
 */
export function checkNpmAllowScripts(): Promise<NpmAllowScriptsVerdict> {
  const [command, args] =
    process.platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", "npm config get allow-scripts"]] : ["npm", ["config", "get", "allow-scripts"]];
  return execFileAsync(command, args, { encoding: "utf8", timeout: NPM_CONFIG_TIMEOUT_MS }).then(
    ({ stdout }) => npmAllowScriptsVerdictOf(stdout),
    (): NpmAllowScriptsVerdict => "undetermined",
  );
}
