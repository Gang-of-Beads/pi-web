/**
 * The update command a deployment declared for itself.
 *
 * Managed deployments (the nix flake, installer scripts) update through a
 * command that owns version drift; for the flake that is the lock-and-switch
 * pipeline the owner's nix-config writes into the services' environment. Only
 * the installer knows it - nothing in a store build reveals which pipeline
 * placed it there - so when it is declared it is the update, for the status
 * page's button and for the self-update route alike.
 */
export const PI_WEB_UPDATE_COMMAND_ENV = "PI_WEB_UPDATE_COMMAND";

export function deploymentUpdateCommand(environment: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const value = environment[PI_WEB_UPDATE_COMMAND_ENV]?.trim();
  return value === undefined || value === "" ? undefined : value;
}
