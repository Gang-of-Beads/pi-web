// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiWebConfigResponse } from "../../api";
import { SettingsSessiondPanel } from "./SettingsSessiondPanel";

beforeEach(() => {
  document.body.replaceChildren();
});

describe("SettingsSessiondPanel Ask Questions setting", () => {
  it("lets the user disable ask_user with a daemon config patch", async () => {
    const panel = new SettingsSessiondPanel();
    const onSave = vi.fn();
    panel.configResponse = configResponse(true);
    panel.onSave = onSave;
    document.body.append(panel);
    await panel.updateComplete;

    const toggle = askUserToggle(panel);
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);

    toggle.click();
    await Promise.resolve();

    expect(onSave).toHaveBeenCalledWith({ askUser: false });
  });

  it("keeps an environment-overridden setting read-only", async () => {
    const panel = new SettingsSessiondPanel();
    panel.configResponse = configResponse(true, true);
    document.body.append(panel);
    await panel.updateComplete;

    const toggle = askUserToggle(panel);
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(true);
  });

  it("does not offer an unsupported setting from an older selected machine", async () => {
    const panel = new SettingsSessiondPanel();
    panel.configResponse = configResponse(undefined);
    document.body.append(panel);
    await panel.updateComplete;

    const toggle = askUserToggle(panel);
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
  });
});

function askUserToggle(panel: SettingsSessiondPanel): HTMLInputElement {
  const toggle = panel.shadowRoot?.querySelector<HTMLInputElement>('input[aria-label="Enable Ask Questions"]');
  if (toggle === undefined || toggle === null) throw new Error("Ask Questions toggle was not rendered");
  return toggle;
}

function configResponse(askUser: boolean | undefined, askUserOverride = false): PiWebConfigResponse {
  const askUserConfig = askUser === undefined ? {} : { askUser };
  return {
    path: "/tmp/pi-web/config.json",
    exists: true,
    config: askUserConfig,
    effectiveConfig: askUserConfig,
    envOverrides: {
      host: false,
      port: false,
      allowedHosts: false,
      spawnSessions: false,
      subsessions: false,
      askUser: askUserOverride,
      agentCommand: false,
      agentDir: false,
      agentSessionDir: false,
    },
  };
}
