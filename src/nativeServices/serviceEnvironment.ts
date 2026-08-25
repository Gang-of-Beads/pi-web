/**
 * Deployment-scoped variables that a managed service must see at runtime but
 * cannot rediscover on its own.
 *
 * `PI_WEB_UPDATE_COMMAND` and `PI_WEB_UPDATE_REPO` tell the running web
 * process how this deployment updates itself. Only the installer knows that:
 * a nix flake, an installer script and a git checkout each answer it
 * differently, and nothing in the store build reveals which one placed it
 * there.
 *
 * They have to be recorded in the service definition because a service
 * manager does not inherit the installing shell's environment. systemd users
 * could write `Environment=` themselves; launchd users could not, so the
 * variable was silently dropped and the update surface reported "no checkout
 * to update (set PI_WEB_UPDATE_REPO)" on a machine that was configured
 * correctly.
 *
 * The list is deliberately short. Capturing every `PI_WEB_*` variable would
 * bake one-off shell state — a temporary port, a session marker, a scratch
 * data directory — into long-lived service files.
 */
export const DEPLOYMENT_SERVICE_ENVIRONMENT_KEYS = ["PI_WEB_UPDATE_COMMAND", "PI_WEB_UPDATE_REPO"] as const;

/**
 * The deployment variables set in `source`, ready to be written into a service
 * definition. Unset and empty values are omitted so an empty assignment cannot
 * shadow a value the service would otherwise resolve.
 */
export function deploymentServiceEnvironment(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of DEPLOYMENT_SERVICE_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (value === undefined || value.trim() === "") continue;
    environment[key] = value;
  }
  return environment;
}
