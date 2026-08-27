import { writeRouteUrl } from "./historyWrites";
export type SettingsSection = "general" | "appearance" | "sessiond" | "machines" | "packages" | "plugins" | "shortcuts";

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
  return undefined;
}
