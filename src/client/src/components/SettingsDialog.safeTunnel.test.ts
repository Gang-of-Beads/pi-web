import { describe, expect, it } from "vitest";
import { activeSettingsPanelTag } from "./SettingsDialog";

describe("settings-dialog Safe Tunnel section", () => {
  it("routes to the Safe Tunnel settings panel", () => {
    expect(activeSettingsPanelTag("safe-tunnel")).toBe("settings-safe-tunnel-panel");
  });
});
