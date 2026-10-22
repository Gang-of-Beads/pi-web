/**
 * The update command this machine declared for itself.
 *
 * Managed deployments (the nix flake, installer scripts) update through a
 * command that owns version drift; for the flake that is the lock-and-switch
 * pipeline a nix configuration writes into the services' environment. Only
 * the installer knows it - nothing in a store build reveals which pipeline
 * placed it there. The reader can also save one in Settings (`updateCommand`
 * in the machine's config, 2026-10-07), which wins: it is the newer and
 * more deliberate statement. Either is the update for the status page's button
 * and for the self-update route alike.
 */
export const PI_WEB_UPDATE_COMMAND_ENV = "PI_WEB_UPDATE_COMMAND";

/** The declared command, and where it was declared: a command from the environment may be another installation's. */
export interface DeclaredUpdateCommand {
  readonly command: string;
  readonly source: "config" | "environment";
}

export function declaredUpdateCommand(saved: string | undefined, environment: Readonly<Record<string, string | undefined>> = process.env): DeclaredUpdateCommand | undefined {
  const fromConfig = nonEmpty(saved);
  if (fromConfig !== undefined) return { command: fromConfig, source: "config" };
  const fromEnvironment = nonEmpty(environment[PI_WEB_UPDATE_COMMAND_ENV]);
  return fromEnvironment === undefined ? undefined : { command: fromEnvironment, source: "environment" };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
