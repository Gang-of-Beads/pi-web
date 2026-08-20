// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWebFleetReport, PiWebFleetRunResponse } from "../../../../shared/apiTypes";
import { SettingsFleetSection } from "./SettingsFleetSection";

afterEach(() => {
  document.body.replaceChildren();
});

const report: PiWebFleetReport = {
  hub: { machineId: "local", name: "This machine" },
  machines: [
    { machineId: "local", name: "This machine", kind: "local", online: true, version: "1.2.3", piVersion: "0.84.2" },
    { machineId: "remote-a", name: "hxd-pi", kind: "remote", online: false, error: "unreachable" },
  ],
};

async function mount(configure: (section: SettingsFleetSection) => void): Promise<SettingsFleetSection> {
  const section = new SettingsFleetSection();
  configure(section);
  document.body.append(section);
  await section.updateComplete;
  return section;
}

function text(section: SettingsFleetSection): string {
  return section.shadowRoot?.textContent ?? "";
}

describe("SettingsFleetSection", () => {
  it("names the hub and how many machines the fan-out would cover", async () => {
    const section = await mount((element) => { element.report = report; });
    expect(text(section)).toContain("This machine");
    expect(text(section)).toContain("2 machines");
  });

  it("shows each machine's version and marks an unreachable one", async () => {
    const section = await mount((element) => { element.report = report; });
    const rows = [...(section.shadowRoot?.querySelectorAll(".machine") ?? [])];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("1.2.3");
    expect(rows[0]?.textContent).toContain("pi 0.84.2");
    expect(rows[1]?.classList.contains("offline")).toBe(true);
    expect(rows[1]?.textContent).toContain("unreachable");
  });

  it("disables the per-machine actions for an offline machine", async () => {
    const section = await mount((element) => { element.report = report; });
    const offline = [...(section.shadowRoot?.querySelectorAll(".machine") ?? [])][1];
    const buttons = [...(offline?.querySelectorAll("button") ?? [])];
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  it("runs an operation and reports the outcome per machine", async () => {
    const runResponse: PiWebFleetRunResponse = {
      operation: "restart",
      hub: { machineId: "local", name: "This machine" },
      outcomes: [
        { machineId: "local", name: "This machine", started: true },
        { machineId: "remote-a", name: "hxd-pi", started: false, error: "restart responded 503" },
      ],
    };
    const onRun = vi.fn(() => Promise.resolve(runResponse));
    const section = await mount((element) => { element.report = report; element.onRun = onRun; });

    const runAll = [...(section.shadowRoot?.querySelectorAll<HTMLButtonElement>(".all-actions button") ?? [])]
      .find((button) => button.textContent.includes("Restart every machine"));
    runAll?.click();
    await section.updateComplete;
    await section.updateComplete;

    expect(onRun).toHaveBeenCalledWith("restart", undefined);
    const outcome = section.shadowRoot?.querySelector(".outcome");
    expect(outcome?.classList.contains("has-failures")).toBe(true);
    expect(outcome?.textContent).toContain("Did not start · hxd-pi");
    expect(outcome?.textContent).toContain("restart responded 503");
  });

  it("surfaces a report error", async () => {
    const section = await mount((element) => { element.error = "GET /api/pi-web/fleet failed: 500"; });
    expect(section.shadowRoot?.querySelector(".error")?.textContent).toContain("500");
  });
});
