import { describe, expect, it } from "vitest";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";
import { askUserConfigPatch, mergeSelectedMachineSessiondConfig } from "./settingsSessiondConfig";

describe("session daemon settings config helpers", () => {
  it("builds daemon-only save patches for the sessiond toggles", () => {
    expect(askUserConfigPatch(false)).toEqual({ askUser: false });
  });

  it("merges local selected-machine daemon config into gateway config without dropping gateway-only values", () => {
    const gateway = configResponse({
      host: "127.0.0.1",
      port: 8504,
      allowedHosts: ["gateway.local"],
      shortcuts: { "core:view.chat": "mod+1" },
      plugins: { info: { enabled: true } },
      agent: { command: "gateway-agent", dir: "/srv/gateway-agent" },
    });
    const selectedMachine = configResponse(
      { agent: { command: "machine-agent", dir: "/srv/machine-agent" } },
      { askUser: true },
      { agent: { command: "env-agent", dir: "/srv/machine-agent" } },
    );

    expect(mergeSelectedMachineSessiondConfig(gateway, selectedMachine)).toEqual({
      ...gateway,
      config: {
        host: "127.0.0.1",
        port: 8504,
        allowedHosts: ["gateway.local"],
        shortcuts: { "core:view.chat": "mod+1" },
        plugins: { info: { enabled: true } },
        agent: { command: "machine-agent", dir: "/srv/machine-agent" },
      },
      effectiveConfig: {
        host: "127.0.0.1",
        port: 8504,
        allowedHosts: ["gateway.local"],
        shortcuts: { "core:view.chat": "mod+1" },
        plugins: { info: { enabled: true } },
        agent: { command: "env-agent", dir: "/srv/machine-agent" },
      },
      envOverrides: {
        host: false,
        port: false,
        allowedHosts: false,
        askUser: true,
      },
    });
  });
});

function configResponse(
  config: PiWebConfigValues,
  overrides: Partial<PiWebConfigResponse["envOverrides"]> = {},
  effectiveConfig: PiWebConfigValues = config,
): PiWebConfigResponse {
  return {
    path: "/tmp/pi-web/config.json",
    exists: true,
    config,
    effectiveConfig,
    envOverrides: {
      host: false,
      port: false,
      allowedHosts: false,
      askUser: false,
      ...overrides,
    },
  };
}
