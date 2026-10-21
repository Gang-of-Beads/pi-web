import { createRequire } from "node:module";
import { piWebGlobalInstallCommand, type NpmAllowScriptsVerdict } from "../npmAllowScripts.js";

const doctorLabel = "node-pty native module loadable";
const requireFromHere = createRequire(import.meta.url);

type LoadNodePty = () => unknown;

export interface NodePtyNativeModuleCheckOptions {
  load?: LoadNodePty;
}

export type NodePtyNativeModuleCheck =
  | { status: "ok" }
  | { status: "load-failed"; message: string };

export interface FormattedNodePtyNativeModuleCheck {
  ok: boolean;
  lines: string[];
}

/**
 * How a module that does not load is marked. Doctor warns (owner, 2026-10-21): sessions work without
 * it and only terminals are lost. The service install still refuses, as a service host is expected
 * to have terminals.
 */
export type NodePtyLoadFailureSeverity = "warning" | "failure";

const loadFailureMarks: Readonly<Record<NodePtyLoadFailureSeverity, string>> = { warning: "!", failure: "✗" };

/** Where npm builds node-pty from source with the distribution's build tools: Linux outside Termux, which has no prebuilt binary. */
export type NodePtyBuildHost = "linux" | "other";

const reinstallAdvice: Readonly<Record<NodePtyBuildHost, readonly string[]>> = {
  linux: [
    "  On Linux npm builds node-pty from source, which needs python3, make and a C++ compiler",
    "  (Debian, Ubuntu: `apt install build-essential python3`; Fedora: `dnf install gcc-c++ make python3`).",
    "  Without them npm skips node-pty, and npm 12 also skips its build unless it is approved.",
    "  For a global npm installation, install the build tools, then reinstall PI WEB with:",
  ],
  other: [
    "  npm may have skipped node-pty's required install script.",
    "  For a global npm installation, reinstall PI WEB with:",
  ],
};

export function checkNodePtyNativeModule(options: NodePtyNativeModuleCheckOptions = {}): NodePtyNativeModuleCheck {
  try {
    (options.load ?? loadNodePty)();
    return { status: "ok" };
  } catch (error) {
    return { status: "load-failed", message: errorMessage(error) };
  }
}

export function formatNodePtyNativeModuleCheck(check: NodePtyNativeModuleCheck, severity: NodePtyLoadFailureSeverity, buildHost: NodePtyBuildHost, npmAllowScripts: NpmAllowScriptsVerdict): FormattedNodePtyNativeModuleCheck {
  if (check.status === "ok") return { ok: true, lines: [`✓ ${doctorLabel}`] };
  return {
    ok: false,
    lines: [
      `${loadFailureMarks[severity]} ${doctorLabel}`,
      `  Could not load node-pty: ${check.message}`,
      "  Terminals are unavailable until it loads; sessions keep working.",
      ...reinstallAdvice[buildHost],
      `    ${piWebGlobalInstallCommand(npmAllowScripts)}`,
      "  Then run `pi-web doctor` again.",
    ],
  };
}

function loadNodePty(): unknown {
  return requireFromHere("node-pty");
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/g, " ").trim();
}
