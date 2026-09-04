import { writeRouteUrl } from "./historyWrites";
import type { QualifiedContributionId } from "./plugins/ids";

export type CoreSettingsSection = "general" | "appearance" | "sessiond" | "machines" | "packages" | "plugins" | "shortcuts";

/**
 * A settings section is either one the core owns or one a plugin contributed.
 * The two are told apart by shape rather than by a list the core has to keep
 * updating: a contributed section always carries its plugin's namespace, and
 * a core section never does.
 */
export type SettingsSection = CoreSettingsSection | QualifiedContributionId;

const qualifiedSectionPattern = /^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$/u;

export function isPluginSettingsSection(section: string): section is QualifiedContributionId {
  return qualifiedSectionPattern.test(section);
}

export function readSettingsSection(): SettingsSection | undefined {
  return parseSettingsSection(new URLSearchParams(window.location.search).get("settings"));
}

export function writeSettingsSection(section: SettingsSection | undefined, options?: { replace?: boolean | undefined }): void {
  const url = new URL(window.location.href);
  if (section === undefined) url.searchParams.delete("settings");
  else url.searchParams.set("settings", section);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  writeRouteUrl(String(url), options?.replace === true);
}

export function parseSettingsSection(value: string | null): SettingsSection | undefined {
  if (value === "general") return "general";
  if (value === "appearance" || value === "theme" || value === "themes") return "appearance";
  if (value === "sessiond" || value === "sessions") return "sessiond";
  if (value === "machines") return "machines";
  if (value === "packages" || value === "pi-packages") return "packages";
  if (value === "plugins") return "plugins";
  if (value === "shortcuts" || value === "keyboard" || value === "keyboard-shortcuts") return "shortcuts";
  if (value !== null && isPluginSettingsSection(value)) return value;
  return undefined;
}
