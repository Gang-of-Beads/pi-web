import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";



export function askUserConfigPatch(enabled: boolean): PiWebConfigValues {
  return { askUser: enabled };
}

export function mergeSelectedMachineSessiondConfig(base: PiWebConfigResponse, selectedMachine: PiWebConfigResponse): PiWebConfigResponse {
  return {
    ...base,
    config: { ...base.config, ...selectedMachine.config },
    effectiveConfig: { ...base.effectiveConfig, ...selectedMachine.effectiveConfig },
    envOverrides: {
      ...base.envOverrides,
      askUser: selectedMachine.envOverrides.askUser,
    },
  };
}
