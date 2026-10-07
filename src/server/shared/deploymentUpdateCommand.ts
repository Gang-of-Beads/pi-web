/**
 * The update command this machine declared for itself.
 *
 * Managed deployments (the nix flake, installer scripts) update through a
 * command that owns version drift; for the flake that is the lock-and-switch
 * pipeline the owner's nix-config writes into the services' environment. Only
 * the installer knows it - nothing in a store build reveals which pipeline
 * placed it there. The reader can also save one in Settings (`updateCommand`
 * in the machine's config, owner 2026-10-07), which wins: it is the newer and
 * more deliberate statement. Either is the update for the status page's button
 * and for the self-update route alike.
 */
export const PI_WEB_UPDATE_COMMAND_ENV = "PI_WEB_UPDATE_COMMAND";

export function configuredUpdateCommand(saved: string | undefined, environment: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  return nonEmpty(saved) ?? nonEmpty(environment[PI_WEB_UPDATE_COMMAND_ENV]);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
