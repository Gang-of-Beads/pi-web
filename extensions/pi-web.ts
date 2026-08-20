import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(packageRoot, "dist", "cli.js");
const serviceNames = ["pi-web-sessiond.service", "pi-web.service", "pi-web-ui-dev.service"];
const macLogPaths = ["sessiond.log", "web.log", "ui-dev.log"].map((name) => join(homedir(), ".pi-web", "logs", name));

const subcommands = [
  "install",
  "status",
  "logs",
  "restart",
  "update",
  "machines",
  "start",
  "stop",
  "doctor",
  "version",
  "uninstall",
  "open",
  "help",
] as const;

type Subcommand = (typeof subcommands)[number];

/**
 * Subcommands that can address more than this machine.
 *
 * Fan-out is done by the PI WEB server, not here: the scope of "every machine"
 * is then the machine list of one named server, which the report states, rather
 * than whichever machine happened to own the session this command ran in.
 */
const FLEET_SUBCOMMANDS = new Set<Subcommand>(["restart", "update", "machines"]);

interface FleetIdentity { machineId: string; name: string }
interface FleetTargetReport extends FleetIdentity { kind: string; online: boolean; version?: string; piVersion?: string; error?: string }
interface FleetReport { hub: FleetIdentity; machines: FleetTargetReport[] }
interface FleetOutcome extends FleetIdentity { started: boolean; error?: string }
interface FleetRunResponse { operation: string; hub: FleetIdentity; outcomes: FleetOutcome[] }

interface ParsedFlags {
  all: boolean;
  machines: string[];
  rest: string[];
}

function parseFlags(args: string[]): ParsedFlags {
  const machines: string[] = [];
  const rest: string[] = [];
  let all = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--all" || arg === "all") { all = true; continue; }
    if (arg.startsWith("--machine=")) { machines.push(arg.slice("--machine=".length)); continue; }
    if (arg === "--machine") { const next = args[index + 1]; if (next !== undefined) { machines.push(next); index++; } continue; }
    rest.push(arg);
  }
  return { all, machines, rest };
}

/**
 * The PI WEB server this agent process can reach. A session runs on the machine
 * that owns it, so this is that machine's server - which the report names, so a
 * fan-out is never mistaken for one started from a different browser's hub.
 */
function piWebBaseUrl(): string {
  const advertised = process.env["PI_WEB_BASE_URL"];
  if (advertised !== undefined && advertised !== "") return advertised.replace(/\/$/, "");
  const port = process.env["PI_WEB_PORT"];
  return `http://127.0.0.1:${port !== undefined && port !== "" ? port : "8504"}`;
}

async function fleetRequest(path: string, init?: { method: string; body: unknown }): Promise<unknown> {
  const response = await fetch(`${piWebBaseUrl()}${path}`, {
    method: init?.method ?? "GET",
    headers: { accept: "application/json", ...(init === undefined ? {} : { "content-type": "application/json" }) },
    ...(init === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed: ${String(response.status)}`);
  return await response.json();
}

/**
 * Read the server's answer defensively.
 *
 * The response crosses a version boundary - an older or newer PI WEB may be
 * answering - so the shape is checked rather than asserted, and a machine that
 * does not parse is reported as such instead of rendering as "undefined".
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readIdentity(value: unknown): FleetIdentity {
  if (!isRecord(value)) return { machineId: "unknown", name: "unknown machine" };
  return {
    machineId: typeof value["machineId"] === "string" ? value["machineId"] : "unknown",
    name: typeof value["name"] === "string" ? value["name"] : "unknown machine",
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readFleetReport(value: unknown): FleetReport {
  const record = isRecord(value) ? value : {};
  const machines = Array.isArray(record["machines"]) ? record["machines"] : [];
  return {
    hub: readIdentity(record["hub"]),
    machines: machines.map((entry) => {
      const machine = isRecord(entry) ? entry : {};
      const version = readString(machine["version"]);
      const piVersion = readString(machine["piVersion"]);
      const error = readString(machine["error"]);
      return {
        ...readIdentity(entry),
        kind: readString(machine["kind"]) ?? "unknown",
        online: machine["online"] === true,
        ...(version === undefined ? {} : { version }),
        ...(piVersion === undefined ? {} : { piVersion }),
        ...(error === undefined ? {} : { error }),
      };
    }),
  };
}

function readFleetRun(value: unknown): FleetRunResponse {
  const record = isRecord(value) ? value : {};
  const outcomes = Array.isArray(record["outcomes"]) ? record["outcomes"] : [];
  return {
    operation: readString(record["operation"]) ?? "operation",
    hub: readIdentity(record["hub"]),
    outcomes: outcomes.map((entry) => {
      const outcome = isRecord(entry) ? entry : {};
      const error = readString(outcome["error"]);
      return { ...readIdentity(entry), started: outcome["started"] === true, ...(error === undefined ? {} : { error }) };
    }),
  };
}

function formatFleetReport(report: FleetReport): string {
  const rows = report.machines.map((machine) => {
    const state = machine.online ? "online" : `offline${machine.error === undefined ? "" : ` (${machine.error})`}`;
    const version = machine.version === undefined ? "version unknown" : `pi-web ${machine.version}`;
    const pi = machine.piVersion === undefined ? "" : `, pi ${machine.piVersion}`;
    return `  ${machine.name} [${machine.kind}] — ${state}, ${version}${pi}`;
  });
  return [`Machines known to ${report.hub.name}:`, ...rows].join("\n");
}

function formatFleetRun(response: FleetRunResponse, scope: string): string {
  const lines = response.outcomes.map((outcome) => `  ${outcome.started ? "started" : "FAILED "} ${outcome.name}${outcome.error === undefined ? "" : ` — ${outcome.error}`}`);
  const failed = response.outcomes.filter((outcome) => !outcome.started).length;
  const summary = `${response.operation} on ${scope}: ${String(response.outcomes.length - failed)}/${String(response.outcomes.length)} started`;
  // Naming the server that fanned out is the whole point: "all" means the
  // machines *it* knows, and a different machine may know a different set.
  return [`${summary} (fanned out from ${response.hub.name})`, ...lines].join("\n");
}

function parseArgs(args: string): string[] {
  return args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => {
    if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
      return part.slice(1, -1);
    }
    return part;
  }) ?? [];
}

function truncateOutput(output: string): string {
  const trimmed = output.trim();
  if (trimmed.length <= 3_500) return trimmed;
  return `${trimmed.slice(0, 3_500)}\n… output truncated`;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { output += chunk; });
    child.on("error", (error) => {
      resolve({ code: 1, output: error.message });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

async function runPiWeb(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; output: string }> {
  if (existsSync(cliPath)) {
    return run(process.execPath, [cliPath, ...args], env);
  }
  return run("pi-web", args, env);
}

function showResult(ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error" | "success"): void } }, title: string, result: { code: number; output: string }): void {
  const body = truncateOutput(result.output) || (result.code === 0 ? "Done." : `Command failed with exit code ${String(result.code)}.`);
  ctx.ui.notify(`${title}\n\n${body}`, result.code === 0 ? "info" : "error");
}

function isSubcommand(value: string): value is Subcommand {
  return subcommands.some((command) => command === value);
}

async function boundedLogs(): Promise<{ code: number; output: string }> {
  if (process.platform === "darwin") {
    const existingLogs = macLogPaths.filter((path) => existsSync(path));
    if (existingLogs.length === 0) return { code: 1, output: "No PI WEB log files found in ~/.pi-web/logs." };
    return run("tail", ["-n", "100", ...existingLogs]);
  }
  return run("journalctl", ["--user", ...serviceNames.flatMap((serviceName) => ["-u", serviceName]), "-n", "100", "--no-pager"]);
}

export default function piWebExtension(pi: ExtensionAPI): void {
  pi.registerCommand("pi-web", {
    // The list is the discovery surface: a subcommand missing from here is one
    // nobody finds. update and machines were added and left out of it.
    description: "Manage PI WEB services and machines: status, machines, restart, update (add --all or --machine=<name>), logs, start, stop, install, doctor, version, open",
    getArgumentCompletions(prefix: string): { value: string; label: string }[] | null {
      const [first = ""] = parseArgs(prefix);
      const items = subcommands
        .filter((command) => command.startsWith(first))
        .map((command) => ({ value: command, label: command }));
      return items.length > 0 ? items : null;
    },
    async handler(args, ctx) {
      const parsedArgs = parseArgs(args);
      const subcommand = parsedArgs[0] ?? "help";
      const rest = parsedArgs.slice(1);

      if (subcommand === "help") {
        ctx.ui.notify([
          "PI WEB commands:",
          "",
          "  /pi-web machines                list the machines this server knows",
          "  /pi-web restart [--all]         restart PI WEB here, or on every known machine",
          "  /pi-web update [--all]          update PI WEB here, or on every known machine",
          "  /pi-web restart --machine=NAME  restart one machine by name or id",
          "  /pi-web status [--all]          service status here, or every machine's version",
          "  /pi-web logs                    last 100 service log lines",
          "  /pi-web install | start | stop | doctor | version | uninstall | open",
          "",
          "--all covers the machines known to the PI WEB server this session runs on;",
          "every fan-out report names that server so the scope is never ambiguous.",
        ].join("\n"), "info");
        return;
      }

      if (subcommand === "open") {
        ctx.ui.notify("PI WEB default URL: http://127.0.0.1:8504", "info");
        return;
      }

      if (!isSubcommand(subcommand)) {
        ctx.ui.notify(`Unknown pi-web command: ${subcommand}. Try /pi-web help.`, "error");
        return;
      }

      if (subcommand === "stop" || subcommand === "uninstall") {
        const ok = await ctx.ui.confirm(`pi-web ${subcommand}`, `Run pi-web ${subcommand}?`);
        if (!ok) return;
      }

      if (subcommand === "logs") {
        showResult(ctx, "pi-web logs", await boundedLogs());
        return;
      }

      const flags = parseFlags(rest);
      if (FLEET_SUBCOMMANDS.has(subcommand) && (subcommand === "machines" || flags.all || flags.machines.length > 0)) {
        await runFleetCommand(ctx, subcommand, flags);
        return;
      }
      if (subcommand === "status" && flags.all) {
        await runFleetCommand(ctx, "machines", flags);
        return;
      }
      if (subcommand === "machines" || subcommand === "update") {
        // Both only exist as fleet operations; without a target they mean this
        // machine, which the server can still answer for.
        await runFleetCommand(ctx, subcommand, { ...flags, machines: ["local"] });
        return;
      }

      showResult(ctx, `pi-web ${subcommand}`, await runPiWeb([subcommand, ...flags.rest]));
    },
  });
}

async function runFleetCommand(
  ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error" | "success"): void } },
  subcommand: Subcommand,
  flags: ParsedFlags,
): Promise<void> {
  try {
    if (subcommand === "machines") {
      ctx.ui.notify(formatFleetReport(readFleetReport(await fleetRequest("/api/pi-web/fleet"))), "info");
      return;
    }
    const operation = subcommand === "update" ? "update" : "restart";
    const scope = flags.all ? "every known machine" : flags.machines.join(", ");
    const response = readFleetRun(await fleetRequest("/api/pi-web/fleet/run", {
      method: "POST",
      body: { operation, ...(flags.all ? {} : { machineIds: flags.machines }) },
    }));
    const failed = response.outcomes.filter((outcome) => !outcome.started).length;
    ctx.ui.notify(formatFleetRun(response, scope), failed === 0 ? "info" : "error");
  } catch (error) {
    ctx.ui.notify(`pi-web ${subcommand} failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}
