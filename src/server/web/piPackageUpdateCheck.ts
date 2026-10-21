import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { PiPackageServerProcess, PiPackageSourceKind, PiPackageUpdate, PiPackageUpdates, PiPackageUpdateState } from "../../shared/apiTypes.js";
import { isRecord } from "../../shared/unknownValues.js";
import type { PiWebPluginRuns } from "../shared/piWebPluginCatalog.js";
import { isNewerPackageVersion, skipVersionCheck } from "../shared/piWebStatus.js";

/**
 * Which of this machine's pi packages have a newer version, for the Updates page.
 *
 * pi's own `checkForAvailableUpdates()` answers only "these have an update", with no versions, and
 * turns every failure (network, auth, a bad answer) into "no update": the page could not tell an
 * up-to-date package from one it failed to ask. This check reads the versions itself with the
 * rules pi updates by (`npm view` through the profile's `npmCommand`, from the folder pi's own
 * update runs npm in, `git ls-remote` against the checkout's upstream, ranges answered by the
 * registry, exact versions and git refs pinned) and keeps every failure as the package's own
 * `failed` state.
 *
 * Only the active profile's user scope is checked: the web process's project scope is the folder
 * the server started in, not a PI WEB project. The newest versions are cached per agent dir for six
 * hours, the release check's TTL; installed versions are re-read on every status read, so an
 * update shows as current as soon as the status is read again. Listing the configured packages is
 * synchronous in pi (a settings file lock, possibly `npm root -g`), so the listing is kept per
 * agent dir and listed again only when the settings file changes, a package mutation drops it, or
 * Check now asks.
 */

const CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const FORCED_CHECK_DEADLINE_MS = 20_000;
const NETWORK_TIMEOUT_MS = 10_000;
const CHECK_CONCURRENCY = 4;
const ERROR_MAX_LENGTH = 200;
const CHECK_TIMED_OUT = "check timed out";

const execFileAsync = promisify(execFile);

export interface ConfiguredPiPackage {
  readonly source: string;
  readonly installedPath?: string;
}

/** Where the newest version is asked: the registry for an npm spec, the remote for a git checkout. */
export type NewestVersionTarget =
  | { readonly kind: "npm"; readonly spec: string }
  | { readonly kind: "git"; readonly installedPath: string };

/** The effects the check needs, injectable so the classification runs without npm, git or a profile. */
export interface PiPackageVersionReaders {
  /** Synchronous in pi; the check calls it only when `settingsStamp` changed or the listing was dropped. */
  configuredUserPackages(agentDir: string): ConfiguredPiPackage[];
  /** What identifies the agent dir's settings file as last written; "absent" without one. */
  settingsStamp(agentDir: string): Promise<string>;
  installedVersion(kind: Exclude<PiPackageSourceKind, "local">, installedPath: string): Promise<string | undefined>;
  /** The processes that load the PI WEB server plugins the installed package declares. */
  serverPluginProcesses(installedPath: string): Promise<PiPackageServerProcess[]>;
  /** The newest version the source allows; rejects with the tool's own words. */
  newestVersion(target: NewestVersionTarget, agentDir: string): Promise<string>;
}

export interface PiPackageUpdateCheckOptions {
  readers?: PiPackageVersionReaders;
  /** Called when a check finishes, so a cached status that predates it is dropped. */
  onChecked?: () => void;
  now?: () => number;
  skipped?: () => boolean;
  forcedDeadlineMs?: number;
}

export interface PiPackageUpdateCheck {
  /** The last answer for this profile; starts a background check when it is missing, stale or lacks a configured source. `force` lists the packages again and waits for a fresh check, up to 20 s. */
  status(agentDir: string, options?: { force?: boolean }): Promise<PiPackageUpdates>;
  /** Drops every kept package listing: an install, removal or update changed what is configured or installed. */
  forgetListings(): void;
}

type NewestAnswer = { readonly version: string } | { readonly error: string };

type PackageListing = { readonly packages: readonly ConfiguredPiPackage[] } | { readonly error: string };

interface KeptListing {
  readonly stamp: string;
  readonly listing: PackageListing;
}

interface RunningCheck {
  readonly promise: Promise<void>;
  readonly answers: Map<string, NewestAnswer>;
  readonly sources: readonly string[];
}

interface ProfileChecks {
  checkedAt?: number;
  answers: Map<string, NewestAnswer>;
  running: RunningCheck | undefined;
}

/** A source's kind, name and pin; an npm source also carries what `npm view` is asked: the spec with its range or tag, else the bare name. */
type SourceFacts =
  | { readonly kind: "npm"; readonly displayName: string; readonly pinned: boolean; readonly npmSpec: string }
  | { readonly kind: Exclude<PiPackageSourceKind, "npm">; readonly displayName: string; readonly pinned: boolean };

/**
 * The source's kind, name and pin, mirroring pi's private `parseSource`.
 * shortcut: this copies pi's source grammar; switch to pi's export if pi ever exports one.
 */
export function piPackageSourceFacts(source: string): SourceFacts {
  const trimmed = source.trim();
  if (trimmed.startsWith("npm:")) return npmSourceFacts(trimmed.slice("npm:".length).trim());
  if (isLocalPathSource(trimmed)) return { kind: "local", displayName: trimmed, pinned: false };
  const hasGitPrefix = trimmed.startsWith("git:");
  const spec = hasGitPrefix ? trimmed.slice("git:".length).trim() : trimmed;
  if (!hasGitPrefix && !/^(https?|ssh|git):\/\//iu.test(spec)) return { kind: "local", displayName: trimmed, pinned: false };
  const ref = gitRef(spec);
  return { kind: "git", displayName: gitDisplayName(spec, ref), pinned: ref !== undefined };
}

function npmSourceFacts(spec: string): SourceFacts {
  const match = /^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/u.exec(spec);
  const name = match?.[1] ?? spec;
  const version = match?.[2];
  return {
    kind: "npm",
    displayName: name,
    pinned: version !== undefined && EXACT_VERSION.test(version),
    npmSpec: version === undefined ? name : spec,
  };
}

const EXACT_VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function isLocalPathSource(source: string): boolean {
  return !["npm:", "git:", "github:", "http:", "https:", "ssh:", "builtin:"].some((prefix) => source.startsWith(prefix));
}

function gitRepositoryPath(spec: string): string {
  const scp = /^git@[^:]+:(.+)$/u.exec(spec);
  if (scp?.[1] !== undefined) return scp[1];
  if (spec.includes("://")) {
    try {
      return new URL(spec).pathname.replace(/^\/+/u, "");
    } catch {
      return "";
    }
  }
  return spec.slice(spec.indexOf("/") + 1);
}

function gitRef(spec: string): string | undefined {
  const hash = spec.indexOf("#");
  if (hash >= 0) return nonEmpty(spec.slice(hash + 1));
  const path = gitRepositoryPath(spec);
  const at = path.indexOf("@");
  return at > 0 ? nonEmpty(path.slice(at + 1)) : undefined;
}

/**
 * The repository as host and path, without the credentials a URL may carry, whatever characters
 * they hold: everything up to the last "@" before the path goes, and an scp-like `user@host:path`
 * keeps `host/path`. A ref was cut off before, so no "@" of the path is left to cut at.
 */
function gitDisplayName(spec: string, ref: string | undefined): string {
  const withoutRef = ref === undefined ? spec : spec.slice(0, spec.length - ref.length - 1);
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//iu.exec(withoutRef)?.[0];
  const rest = withoutRef.slice(scheme?.length ?? 0);
  const hostAndPath = rest.slice(rest.lastIndexOf("@") + 1);
  return (scheme === undefined ? hostAndPath.replace(/^([^/:]+):/u, "$1/") : hostAndPath).replace(/\.git$/u, "");
}

function nonEmpty(value: string): string | undefined {
  return value === "" ? undefined : value;
}

interface RowFacts {
  readonly kind: PiPackageSourceKind;
  readonly pinned: boolean;
  readonly installed: string | undefined;
  readonly answer: NewestAnswer | undefined;
}

/** A package's state from what is installed and what its source answered; `checking` while it waits for its first answer. */
export function piPackageUpdateState(facts: RowFacts): PiPackageUpdateState {
  if (facts.kind === "local") return "local";
  if (facts.installed === undefined) return "missing";
  if (facts.pinned) return "pinned";
  if (facts.answer === undefined) return "checking";
  if ("error" in facts.answer) return "failed";
  return isNewerVersion(facts.kind, facts.answer.version, facts.installed) ? "newer" : "current";
}

function isNewerVersion(kind: Exclude<PiPackageSourceKind, "local">, available: string, installed: string): boolean {
  return kind === "git" ? available !== installed : isNewerPackageVersion(available, installed);
}

const shortVersion = (kind: PiPackageSourceKind, version: string): string => (kind === "git" ? version.slice(0, 7) : version);

/** What a configured package's newest version is asked of; none for a package that is not installed, pinned, or a local path. */
function newestVersionTarget(entry: ConfiguredPiPackage): NewestVersionTarget | undefined {
  const installedPath = entry.installedPath;
  const facts = piPackageSourceFacts(entry.source);
  if (installedPath === undefined || facts.pinned || facts.kind === "local") return undefined;
  return facts.kind === "npm" ? { kind: "npm", spec: facts.npmSpec } : { kind: "git", installedPath };
}

export function createPiPackageUpdateCheck(options: PiPackageUpdateCheckOptions = {}): PiPackageUpdateCheck {
  const readers = options.readers ?? defaultPiPackageVersionReaders;
  const now = options.now ?? Date.now;
  const skipped = options.skipped ?? skipVersionCheck;
  const deadlineMs = options.forcedDeadlineMs ?? FORCED_CHECK_DEADLINE_MS;
  const profiles = new Map<string, ProfileChecks>();
  const listings = new Map<string, KeptListing>();

  const listingFor = async (agentDir: string, force: boolean): Promise<PackageListing> => {
    const stamp = await readers.settingsStamp(agentDir);
    const kept = listings.get(agentDir);
    if (!force && kept?.stamp === stamp) return kept.listing;
    const listing = listConfiguredPackages(readers, agentDir);
    listings.set(agentDir, { stamp, listing });
    return listing;
  };

  const profileChecks = (agentDir: string): ProfileChecks => {
    const existing = profiles.get(agentDir);
    if (existing !== undefined) return existing;
    const created: ProfileChecks = { answers: new Map(), running: undefined };
    profiles.set(agentDir, created);
    return created;
  };

  const start = (agentDir: string, checks: ProfileChecks, packages: readonly ConfiguredPiPackage[]): RunningCheck => {
    if (checks.running !== undefined) return checks.running;
    const candidates = packages.flatMap((entry) => {
      const target = newestVersionTarget(entry);
      return target === undefined ? [] : [{ source: entry.source, target }];
    });
    const answers = new Map<string, NewestAnswer>();
    const tasks = candidates.map((candidate) => async () => {
      answers.set(candidate.source, await newestAnswer(readers, candidate.target, agentDir));
    });
    const promise = runWithConcurrency(tasks, CHECK_CONCURRENCY)
      .then(() => {
        checks.answers = answers;
        checks.checkedAt = now();
      })
      .finally(() => {
        checks.running = undefined;
        options.onChecked?.();
      });
    const running = { promise, answers, sources: candidates.map((entry) => entry.source) };
    checks.running = running;
    return running;
  };

  const isStale = (checks: ProfileChecks, packages: readonly ConfiguredPiPackage[]): boolean => checks.checkedAt === undefined
    || now() - checks.checkedAt > CHECK_TTL_MS
    || packages.some((entry) => newestVersionTarget(entry) !== undefined && !checks.answers.has(entry.source));

  const waitForced = async (checks: ProfileChecks, running: RunningCheck): Promise<void> => {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<"deadline">((resolve) => { timer = setTimeout(() => { resolve("deadline"); }, deadlineMs); });
    const done: Promise<"done"> = running.promise.then(() => "done");
    const outcome = await Promise.race([done, deadline]);
    clearTimeout(timer);
    if (outcome === "done") return;
    checks.answers = new Map(running.sources.map((source) => [source, running.answers.get(source) ?? { error: CHECK_TIMED_OUT }]));
    checks.checkedAt = now();
  };

  return {
    async status(agentDir, statusOptions = {}) {
      if (skipped()) return { listing: "skipped", checking: false, packages: [] };
      const force = statusOptions.force === true;
      const listing = await listingFor(agentDir, force);
      if ("error" in listing) return { listing: "failed", checking: false, listingError: listing.error, packages: [] };
      const packages = listing.packages;
      const checks = profileChecks(agentDir);
      if (force) {
        await waitForced(checks, checks.running ?? start(agentDir, checks, packages));
      } else if (isStale(checks, packages)) {
        start(agentDir, checks, packages).promise.catch(() => undefined);
      }
      const rows: PiPackageUpdate[] = [];
      await runWithConcurrency(packages.map((entry, index) => async () => {
        rows[index] = await packageRow(readers, entry, checks.answers.get(entry.source));
      }), CHECK_CONCURRENCY);
      return {
        listing: "listed",
        ...(checks.checkedAt === undefined ? {} : { checkedAt: new Date(checks.checkedAt).toISOString() }),
        checking: checks.running !== undefined,
        packages: rows,
      };
    },
    forgetListings() {
      listings.clear();
    },
  };
}

function listConfiguredPackages(readers: PiPackageVersionReaders, agentDir: string): PackageListing {
  try {
    return { packages: readers.configuredUserPackages(agentDir) };
  } catch (error) {
    return { error: oneLineError(error) };
  }
}

async function newestAnswer(readers: PiPackageVersionReaders, target: NewestVersionTarget, agentDir: string): Promise<NewestAnswer> {
  try {
    return { version: await readers.newestVersion(target, agentDir) };
  } catch (error) {
    return { error: oneLineError(error) };
  }
}

async function packageRow(readers: PiPackageVersionReaders, entry: ConfiguredPiPackage, answer: NewestAnswer | undefined): Promise<PiPackageUpdate> {
  const facts = piPackageSourceFacts(entry.source);
  const installedPath = entry.installedPath;
  const installed = facts.kind === "local" || installedPath === undefined ? undefined : await readers.installedVersion(facts.kind, installedPath);
  const state = piPackageUpdateState({ kind: facts.kind, pinned: facts.pinned, installed, answer });
  const available = answer !== undefined && "version" in answer ? answer.version : undefined;
  return {
    source: entry.source,
    displayName: facts.displayName,
    kind: facts.kind,
    ...(installed === undefined ? {} : { installed: shortVersion(facts.kind, installed) }),
    ...(available === undefined || state === "pinned" ? {} : { available: shortVersion(facts.kind, available) }),
    state,
    ...(state === "failed" && answer !== undefined && "error" in answer ? { error: answer.error } : {}),
    serverPluginProcesses: installed === undefined || installedPath === undefined ? [] : await readers.serverPluginProcesses(installedPath),
  };
}

async function runWithConcurrency(tasks: readonly (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      if (task !== undefined) await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

/** The tool's own first words: npm's `E404`/`E401` line, git's refusal, or a timeout. */
function oneLineError(error: unknown): string {
  if (isRecord(error) && (error["killed"] === true || error["code"] === "ETIMEDOUT")) return CHECK_TIMED_OUT;
  const stderr = isRecord(error) && typeof error["stderr"] === "string" ? error["stderr"] : "";
  const line = [...stderr.split("\n"), ...(error instanceof Error ? error.message : String(error)).split("\n")]
    .map((entry) => entry.trim())
    .find((entry) => entry !== "");
  return (line ?? "check failed").slice(0, ERROR_MAX_LENGTH);
}

async function readPackageJson(installedPath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse((await readFile(join(installedPath, "package.json"), "utf8")).replace(/^\uFEFF/u, ""));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function gitOutput(installedPath: string, args: readonly string[], remote: boolean): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd: installedPath,
    encoding: "utf8",
    timeout: NETWORK_TIMEOUT_MS,
    ...(remote ? { env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" } } : {}),
  });
  return stdout.trim();
}

async function remoteGitHead(installedPath: string): Promise<string> {
  const upstream = await gitOutput(installedPath, ["rev-parse", "--abbrev-ref", "@{upstream}"], false).catch(() => "");
  const branch = upstream.startsWith("origin/") ? upstream.slice("origin/".length) : "";
  if (branch !== "") {
    const answer = await gitOutput(installedPath, ["ls-remote", "origin", `refs/heads/${branch}`], true);
    const head = /^([0-9a-f]{40})\s+/mu.exec(answer)?.[1];
    if (head !== undefined) return head;
  }
  const answer = await gitOutput(installedPath, ["ls-remote", "origin", "HEAD"], true);
  const head = /^([0-9a-f]{40})\s+HEAD$/mu.exec(answer)?.[1];
  if (head === undefined) throw new Error("the remote did not name its HEAD");
  return head;
}

async function newestNpmVersion(spec: string, agentDir: string): Promise<string> {
  const [command = "npm", ...args] = SettingsManager.create(process.cwd(), agentDir).getNpmCommand() ?? [];
  const { stdout } = await execFileAsync(command, [...args, "view", spec, "version", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: NETWORK_TIMEOUT_MS,
    shell: process.platform === "win32",
  });
  const answer: unknown = JSON.parse(stdout.trim());
  if (typeof answer === "string" && answer !== "") return answer;
  const versions = Array.isArray(answer) ? answer.filter((entry): entry is string => typeof entry === "string" && entry !== "") : [];
  const newest = versions.reduce<string | undefined>((best, version) => (best === undefined || isNewerPackageVersion(version, best) ? version : best), undefined);
  if (newest === undefined) throw new Error("npm view answered no version");
  return newest;
}

/** Where a server plugin runs, by its `runs` declaration; none means the session daemon (`piWebPluginCatalog.ts`). */
const SERVER_PLUGIN_PROCESSES: Readonly<Record<PiWebPluginRuns, readonly PiPackageServerProcess[]>> = { daemon: ["sessiond"], web: ["web"], both: ["web", "sessiond"] };
const PROCESS_ORDER: readonly PiPackageServerProcess[] = ["web", "sessiond"];

function pluginRuns(value: unknown): PiWebPluginRuns | undefined {
  if (value === undefined) return "daemon";
  return value === "daemon" || value === "web" || value === "both" ? value : undefined;
}

export const defaultPiPackageVersionReaders: PiPackageVersionReaders = {
  settingsStamp: async (agentDir) => {
    try {
      const settings = await stat(join(agentDir, "settings.json"));
      return `${String(settings.mtimeMs)}:${String(settings.size)}`;
    } catch {
      return "absent";
    }
  },
  configuredUserPackages: (agentDir) => {
    const settingsManager = SettingsManager.create(process.cwd(), agentDir);
    return new DefaultPackageManager({ cwd: process.cwd(), agentDir, settingsManager })
      .listConfiguredPackages()
      .filter((entry) => entry.scope === "user")
      .map((entry) => ({ source: entry.source, ...(entry.installedPath === undefined ? {} : { installedPath: entry.installedPath }) }));
  },
  installedVersion: async (kind, installedPath) => {
    if (kind === "git") return await gitOutput(installedPath, ["rev-parse", "HEAD"], false).catch(() => undefined);
    const version = (await readPackageJson(installedPath))?.["version"];
    return typeof version === "string" && version !== "" ? version : undefined;
  },
  serverPluginProcesses: async (installedPath) => {
    const piWeb = (await readPackageJson(installedPath))?.["piWeb"];
    const plugins: unknown[] = isRecord(piWeb) && Array.isArray(piWeb["plugins"]) ? piWeb["plugins"] : [];
    const processes = new Set(plugins.flatMap((plugin) => {
      if (!isRecord(plugin) || typeof plugin["serverModule"] !== "string" || plugin["serverModule"] === "") return [];
      const runs = pluginRuns(plugin["runs"]);
      return runs === undefined ? [] : SERVER_PLUGIN_PROCESSES[runs];
    }));
    return PROCESS_ORDER.filter((name) => processes.has(name));
  },
  newestVersion: async (target, agentDir) => (target.kind === "npm" ? await newestNpmVersion(target.spec, agentDir) : await remoteGitHead(target.installedPath)),
};
