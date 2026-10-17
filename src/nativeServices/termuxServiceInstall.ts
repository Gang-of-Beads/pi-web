import { existsSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { posix as posixPath } from "node:path";
import {
  orderServices,
  restartsInPlace,
  ServiceCommandError,
  serviceStopOrder,
  type LifecycleServiceRef,
  type ServiceActionDeps,
} from "./serviceAction.js";
import type { NativeServicePlan } from "./servicePlan.js";
import {
  renderTermuxBootScript,
  renderTermuxServiceRunScript,
  termuxServiceActionArgs,
  termuxServiceDirectory,
  termuxServiceRoot,
} from "./termuxServices.js";

const supervisionTimeoutMs = 15_000;
const supervisionPollMs = 250;

export interface TermuxServiceInstallContext {
  /** Every service PI WEB can install; those missing from the plan are removed. */
  allRefs: readonly LifecycleServiceRef[];
  logDirectory: string;
  bootScriptPath: string;
  hostingServiceId: string | undefined;
}

type TermuxServiceCommandDeps = Pick<ServiceActionDeps, "run" | "runQuiet" | "sleep">;

/**
 * Write the run scripts and the Termux:Boot script, then (re)start the
 * services through runsv. A new service directory is staged under a dot name,
 * which runsvdir ignores, and renamed into place whole; an existing one gets
 * its `run` file replaced, because runsv keeps working inside that directory.
 * Removing a `down` file enables the service the way `sv-enable` does.
 *
 * The service this command runs inside is started, never restarted: the
 * restart would stop the command before it finished. Returns those services,
 * which keep the previous build until they are restarted from outside.
 */
export async function installTermuxServices(
  plan: NativeServicePlan,
  context: TermuxServiceInstallContext,
  deps: TermuxServiceCommandDeps,
): Promise<LifecycleServiceRef[]> {
  const selected = new Set(plan.services.map((service) => service.id));
  const obsolete = context.allRefs.filter((ref) => !selected.has(ref.id));
  for (const ref of orderServices(obsolete, serviceStopOrder)) await removeTermuxService(ref, deps);

  await mkdir(context.logDirectory, { recursive: true });
  await mkdir(termuxServiceRoot, { recursive: true });
  for (const service of plan.services) {
    await writeTermuxServiceDirectory(
      termuxServiceDirectory(service.manager),
      renderTermuxServiceRunScript(plan, service, context.logDirectory),
    );
  }
  await mkdir(posixPath.dirname(context.bootScriptPath), { recursive: true });
  await writeFile(context.bootScriptPath, renderTermuxBootScript());
  await chmod(context.bootScriptPath, 0o700);

  const refs = plan.services.map((service): LifecycleServiceRef => ({ id: service.id, ...service.manager }));
  const unsupervised = await awaitTermuxSupervision(refs.map(termuxServiceDirectory), deps);
  if (unsupervised.length > 0) {
    throw new Error(`termux-services is not supervising ${unsupervised.join(", ")}. Start its supervisor with \`service-daemon start\` or by opening a new Termux session, then run \`pi-web start\`.`);
  }

  const hosted = refs.filter((ref) => restartsInPlace(ref.id, context.hostingServiceId));
  const restartable = refs.filter((ref) => !hosted.includes(ref));
  if (restartable.length > 0) runCheckedSv(deps, termuxServiceActionArgs("restart", restartable.map(termuxServiceDirectory)));
  if (hosted.length > 0) runCheckedSv(deps, termuxServiceActionArgs("start", hosted.map(termuxServiceDirectory)));
  return hosted;
}

/** Remove the boot script first, so a command stopped with the session daemon leaves nothing that starts the services at the next boot. */
export async function uninstallTermuxServices(
  refs: readonly LifecycleServiceRef[],
  bootScriptPath: string,
  deps: TermuxServiceCommandDeps,
): Promise<void> {
  await rm(bootScriptPath, { force: true });
  for (const ref of orderServices(refs, serviceStopOrder)) await removeTermuxService(ref, deps);
}

/**
 * Stop a service, let its runsv exit, then delete the directory. Deleting
 * first would also stop it, but only once runsvdir next scans the root.
 */
async function removeTermuxService(ref: LifecycleServiceRef, deps: TermuxServiceCommandDeps): Promise<void> {
  const directory = termuxServiceDirectory(ref);
  if (!existsSync(directory)) return;
  deps.runQuiet("sv", termuxServiceActionArgs("stop", [directory]));
  deps.runQuiet("sv", ["exit", directory]);
  await rm(directory, { recursive: true, force: true });
}

async function writeTermuxServiceDirectory(directory: string, runScript: string): Promise<void> {
  if (existsSync(directory)) {
    const stagedRun = posixPath.join(directory, ".run.pi-web-new");
    await rm(stagedRun, { force: true });
    await writeFile(stagedRun, runScript, { mode: 0o700 });
    await rename(stagedRun, posixPath.join(directory, "run"));
  } else {
    const staged = posixPath.join(posixPath.dirname(directory), `.${posixPath.basename(directory)}.pi-web-new`);
    await rm(staged, { recursive: true, force: true });
    await mkdir(staged, { mode: 0o700 });
    await writeFile(posixPath.join(staged, "run"), runScript, { mode: 0o700 });
    await rename(staged, directory);
  }
  await rm(posixPath.join(directory, "down"), { force: true });
}

/** runsvdir scans for new directories every five seconds, so the wait allows three scans; returns the directories still unsupervised when it ends. */
async function awaitTermuxSupervision(directories: readonly string[], deps: TermuxServiceCommandDeps): Promise<string[]> {
  const pending = new Set(directories);
  for (let waited = 0; ; waited += supervisionPollMs) {
    for (const directory of [...pending]) {
      if (deps.runQuiet("sv", ["status", directory]) === 0) pending.delete(directory);
    }
    if (pending.size === 0 || waited >= supervisionTimeoutMs) return [...pending];
    await deps.sleep(supervisionPollMs);
  }
}

function runCheckedSv(deps: TermuxServiceCommandDeps, args: string[]): void {
  const status = deps.run("sv", args);
  if (status !== 0) throw new ServiceCommandError("sv", args, status);
}
