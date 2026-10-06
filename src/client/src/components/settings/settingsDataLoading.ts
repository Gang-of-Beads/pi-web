import type { PiPackagesResponse, PiWebConfigResponse, PiWebPluginsResponse } from "../../api";
import { friendlyPiPackageErrorMessage } from "./piPackageSettings";
import { settingsMachineTargetLabel, type SettingsMachineTarget } from "./settingsMachineTarget";
import { describeError } from "../../notice";

export interface GatewaySettingsLoaders {
  loadConfig: () => Promise<PiWebConfigResponse>;
  loadPlugins: () => Promise<PiWebPluginsResponse>;
}

export interface GatewaySettingsLoadResult {
  config?: PiWebConfigResponse;
  plugins?: PiWebPluginsResponse;
  error: string;
}

export async function loadGatewaySettingsData(loaders: GatewaySettingsLoaders): Promise<GatewaySettingsLoadResult> {
  const [config, plugins] = await Promise.allSettled([loaders.loadConfig(), loaders.loadPlugins()]);
  const result: GatewaySettingsLoadResult = { error: "" };
  const errors: string[] = [];

  if (config.status === "fulfilled") result.config = config.value;
  else errors.push(`config: ${describeError(config.reason)}`);

  if (plugins.status === "fulfilled") result.plugins = plugins.value;
  else errors.push(`PI WEB plugins: ${describeError(plugins.reason)}`);

  if (errors.length > 0) result.error = `Failed to load settings: ${errors.join("; ")}`;
  return result;
}

export async function loadPiPackagesData(target: SettingsMachineTarget, loadPackages: (targetId: string) => Promise<PiPackagesResponse>) {
  try {
    return { packagesResponse: await loadPackages(target.id), error: "" };
  } catch (error) {
    return { error: `Failed to load Pi packages from ${settingsMachineTargetLabel(target)}: ${friendlyPiPackageErrorMessage(describeError(error), target)}` };
  }
}
