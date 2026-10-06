import type { PiWebDockerMode, PiWebInstallationInfo, PiWebStatusMessage, PiWebStatusResponse, PluginRuntimeState } from "@gang-of-beads/pi-web/plugin-api";

export interface UpdatesRuntimeHint {
  dockerMode?: PiWebDockerMode;
}

export function messagesFor(state: PluginRuntimeState | undefined): PiWebStatusMessage[] {
  return state?.piWebStatus?.messages ?? [];
}

export function statusFor(state: PluginRuntimeState | undefined): PiWebStatusResponse | undefined {
  return state?.piWebStatus;
}

export function messageCount(state: PluginRuntimeState | undefined): number {
  return messagesFor(state).length;
}

export function isSelfManagedInstallation(installation: PiWebInstallationInfo | undefined): boolean {
  return installation === undefined || installation.kind === "local" || installation.kind === "docker" || installation.kind === "unknown";
}

export function shouldShowUpdatesPanel(state: PluginRuntimeState | undefined, hint: UpdatesRuntimeHint = {}): boolean {
  const status = statusFor(state);
  if (hint.dockerMode !== undefined) return true;
  if (messageCount(state) > 0) return true;
  if (status === undefined) return false;
  return isSelfManagedInstallation(status.components.web.installation)
    || isSelfManagedInstallation(status.components.sessiond.installation);
}

export function fallbackDockerStatus(hint: UpdatesRuntimeHint, generatedAt = "federated status unavailable"): PiWebStatusResponse | undefined {
  if (hint.dockerMode === undefined) return undefined;
  const commandPrefix = hint.dockerMode === "dev" ? "pi-web-docker --dev" : "pi-web-docker";
  const installation: PiWebInstallationInfo = { kind: "docker", dockerMode: hint.dockerMode };
  return {
    packageName: "@gang-of-beads/pi-web",
    generatedAt,
    components: {
      web: { component: "web", label: "Web/UI", stale: false, available: true, installation },
      sessiond: { component: "sessiond", label: "Session daemon", stale: false, available: true, installation },
    },
    release: { packageName: "@gang-of-beads/pi-web", updateAvailable: false, skipped: true },
    commands: {
      update: `${commandPrefix} update`,
      restart: `${commandPrefix} restart`,
      restartWeb: `${commandPrefix} restart-web`,
      restartSessiond: `${commandPrefix} restart-sessiond`,
      status: `${commandPrefix} status`,
    },
    messages: [{
      id: "docker-status-compatibility",
      severity: "info",
      title: "Docker update commands available",
      body: "This Updates plugin was loaded from a Docker PI WEB runtime, but the gateway has not provided Docker-aware status details yet. The Docker maintenance commands below are still available.",
    }],
  };
}

export function formatVersion(version: string | undefined): string {
  return version === undefined || version === "" ? "unknown" : version;
}

export function installationLabel(installation: PiWebInstallationInfo | undefined): string {
  if (installation === undefined) return "installation unknown";
  if (installation.manager !== undefined) return installation.manager;
  if (installation.kind === "pi-package") {
    const scope = installation.scope === undefined ? "" : ` · ${installation.scope}`;
    const source = installation.source ?? "Pi package";
    return `${source}${scope}`;
  }
  if (installation.kind === "npm-global") return "global npm package";
  if (installation.kind === "local") return "local checkout";
  if (installation.kind === "docker") return installation.dockerMode === "dev" ? "Docker development runtime" : "Docker runtime";
  return "installation unknown";
}
