export function ownEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return Object.hasOwn(environment, name) ? environment[name] : undefined;
}

/** The variable `pi-web run` sets on the processes it supervises, and the value it sets. */
export const PI_WEB_SUPERVISOR_ENV = "PI_WEB_SUPERVISOR";
export const PI_WEB_RUN_SUPERVISOR = "pi-web-run";

/**
 * Whether this process was started by `pi-web run`. Such a process has no service manager to
 * restart or update it: the container platform, or whoever started `pi-web run`, does that.
 */
export function supervisedByPiWebRun(environment: Readonly<Record<string, string | undefined>>): boolean {
  return ownEnvironmentValue(environment, PI_WEB_SUPERVISOR_ENV) === PI_WEB_RUN_SUPERVISOR;
}
