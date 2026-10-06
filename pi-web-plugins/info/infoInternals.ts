// Implementation details of the bundled Info plugin.
//
// This file is NOT part of the plugin skeleton. If you copied the Info plugin
// as a starting point for your own plugin, replace everything here with your
// own content — the plugin contract (metadata and contribution definitions)
// lives in pi-web-plugin.ts.

import type { TemplateResult } from "lit";
import type { HtmlTemplateTag, MachineKind, PiWebComponentStatus, PiWebInstallationInfo, PiWebReleaseStatus, PiWebStatusResponse, PluginHostUi, PluginListModel, PluginListRow, PluginListTone, PluginMachine, PluginRuntimeContext, Workspace, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";

export type ComponentHealth = "current" | "restart needed" | "unavailable";

export function componentHealth(component: PiWebComponentStatus): ComponentHealth {
  if (!component.available) return "unavailable";
  if (component.stale) return "restart needed";
  return "current";
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

export function machineKindLabel(kind: MachineKind): string {
  return kind === "local" ? "local machine" : "remote machine";
}

export function releaseSummary(release: PiWebReleaseStatus): string {
  if (release.updateAvailable) {
    return release.latestVersion === undefined || release.latestVersion === ""
      ? "Update available"
      : `Update available: ${release.latestVersion}`;
  }
  if (release.error !== undefined && release.error !== "") return `Update check failed: ${release.error}`;
  if (release.skipped === true) return "Update check skipped";
  return "Up to date";
}

/** One-line component summary used by the panel rows and the clipboard diagnostics. */
export function componentDetails(component: PiWebComponentStatus): string {
  const parts = [
    `running ${formatVersion(component.runtimeVersion)}`,
    `installed ${formatVersion(component.installedVersion)}`,
    `pi ${formatVersion(component.piVersion)}`,
    componentHealth(component),
    installationLabel(component.installation),
  ];
  if (component.installation?.path !== undefined && component.installation.path !== "") parts.push(component.installation.path);
  if (component.error !== undefined && component.error !== "") parts.push(`error: ${component.error}`);
  return parts.join(" · ");
}

/** Note shown when the session daemon runs a different Pi version than the web process. */
export function piVersionDriftNote(web: PiWebComponentStatus, sessiond: PiWebComponentStatus): string | undefined {
  if (!sessiond.available) return undefined;
  if (web.piVersion === undefined || sessiond.piVersion === undefined) return undefined;
  return web.piVersion === sessiond.piVersion ? undefined : `session daemon running ${formatVersion(sessiond.piVersion)}`;
}

export function workspaceFlags(workspace: Workspace): string[] {
  return [
    workspace.provider === undefined ? "folder workspace" : `provider: ${workspace.provider.pluginId}`,
    workspace.isMain ? "main workspace" : undefined,
  ].filter((flag): flag is string => flag !== undefined);
}

export interface DiagnosticsInput {
  status: PiWebStatusResponse | undefined;
  machine?: PluginMachine | undefined;
  workspace?: Workspace | undefined;
}

/** Plain-text status block suitable for pasting into a bug report. */
export function diagnosticsSummary({ status, machine, workspace }: DiagnosticsInput): string {
  const lines: string[] = ["PI WEB diagnostics"];
  if (status === undefined) {
    lines.push("Status: unavailable");
  } else {
    lines.push(`Package: ${status.packageName}`);
    lines.push(`${status.components.web.label}: ${componentDetails(status.components.web)}`);
    lines.push(`${status.components.sessiond.label}: ${componentDetails(status.components.sessiond)}`);
    const checked = status.release.checkedAt === undefined || status.release.skipped === true ? "" : ` (checked ${status.release.checkedAt})`;
    lines.push(`Release: ${releaseSummary(status.release)}${checked}`);
    lines.push(`Status generated: ${status.generatedAt}`);
  }
  if (machine !== undefined) lines.push(`Machine: ${machine.name} (${machineKindLabel(machine.kind)})`);
  if (workspace === undefined) {
    lines.push("Workspace: none selected");
  } else {
    lines.push(`Workspace: ${workspace.label} — ${workspace.path} (${workspaceFlags(workspace).join(", ")})`);
  }
  return lines.join("\n");
}

/** Action body: copy the diagnostics summary for the current runtime context. */
export async function copyDiagnostics(context: PluginRuntimeContext): Promise<void> {
  const summary = diagnosticsSummary({
    status: context.state.piWebStatus,
    machine: context.state.selectedMachine,
    workspace: context.state.selectedWorkspace,
  });
  await navigator.clipboard.writeText(summary);
}

const optionalDetail = (detail: string | undefined): Pick<PluginListRow, "detail"> => detail === undefined || detail === "" ? {} : { detail };

const HEALTH_TONE: Readonly<Record<ComponentHealth, PluginListTone>> = { current: "good", "restart needed": "attention", unavailable: "problem" };

function componentRow(id: string, component: PiWebComponentStatus): PluginListRow {
  const health = componentHealth(component);
  return { id, title: component.label, status: { label: health, tone: HEALTH_TONE[health] }, detail: componentDetails(component) };
}

function piWebRows(status: PiWebStatusResponse | undefined): PluginListRow[] {
  if (status === undefined) return [{ id: "status", title: "Status", value: "not available yet", detail: "It refreshes automatically in the background." }];
  const web = status.components.web;
  const installed = web.installedVersion === undefined || web.installedVersion === web.runtimeVersion ? undefined : `installed ${formatVersion(web.installedVersion)}`;
  const checked = status.release.checkedAt === undefined || status.release.skipped === true ? undefined : `checked ${status.release.checkedAt}`;
  return [
    { id: "version", title: "Version", value: formatVersion(web.runtimeVersion), ...optionalDetail(installed) },
    { id: "pi", title: "Pi", value: formatVersion(web.piVersion), ...optionalDetail(piVersionDriftNote(web, status.components.sessiond)) },
    { id: "package", title: "Package", value: status.packageName },
    { id: "installation", title: "Installation", value: installationLabel(web.installation), ...optionalDetail(web.installation?.path) },
    { id: "release", title: "Release", value: releaseSummary(status.release), ...optionalDetail(checked) },
  ];
}

function statusNotes(status: PiWebStatusResponse | undefined): string[] {
  if (status === undefined) return [];
  const count = status.messages.length;
  return [
    ...(count === 0 ? [] : [`${String(count)} status ${count === 1 ? "message" : "messages"} - open the Updates page for details.`]),
    `Status generated ${status.generatedAt}`,
  ];
}

const INFO_WORDS = {
  empty: "Nothing to show for this workspace.",
  reading: "Reading this machine's status…",
  failed: "This machine's status could not be read.",
  stale: "Could not refresh - showing the last read.",
} as const;

/** The Info page as the host's list: PI WEB, its services, the machine and the workspace, each a group of rows. */
export function infoListModel(context: Pick<WorkspacePanelContext, "machine" | "workspace" | "state">): PluginListModel {
  const status = context.state?.piWebStatus;
  const workspace = context.workspace;
  const flags = workspaceFlags(workspace);
  return {
    read: "ready",
    words: INFO_WORDS,
    groups: [
      { id: "pi-web", heading: "PI WEB", rows: piWebRows(status) },
      { id: "services", heading: "Services", rows: status === undefined ? [] : [componentRow("web", status.components.web), componentRow("sessiond", status.components.sessiond)] },
      { id: "machine", heading: "Machine", rows: [{ id: "name", title: "Name", value: context.machine.name }, { id: "type", title: "Type", value: machineKindLabel(context.machine.kind) }] },
      { id: "workspace", heading: "Workspace", rows: [{ id: "name", title: "Name", value: workspace.label }, { id: "path", title: "Path", detail: flags.length === 0 ? workspace.path : `${workspace.path} · ${flags.join(" · ")}` }] },
    ],
    notes: statusNotes(status),
  };
}

/** Panel body: render the Info tab for the current workspace panel context. */
export function renderInfoPanel(html: HtmlTemplateTag, ui: PluginHostUi | undefined, context: WorkspacePanelContext): TemplateResult {
  if (ui?.renderList === undefined) return html`<p class="muted">This page needs a newer PI WEB on this device.</p>`;
  return ui.renderList(infoListModel(context));
}
