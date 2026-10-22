// @vitest-environment happy-dom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { PluginDialog, PluginDialogHandle, PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";
import { showUpdatesOffer, type UpdatesOfferDialogPorts } from "./updateOfferDialog";
import type { OfferAnswerWrites, UpdatesOfferLines } from "./updatesOffer";

/**
 * Owner's ruling (2026-10-21): one "Updates on <machine>" popup; closing it without a choice
 * reminds after a day for every line, PI WEB's included; "Don't remind me about these versions"
 * settles them. A dialog dismissed with no record is what brought the same offer back at once.
 */
function fakeUi() {
  const shown: PluginDialog[] = [];
  const ui: Pick<PluginHostUi, "showDialog"> = {
    showDialog: (dialog) => {
      shown.push(dialog);
      const handle: PluginDialogHandle = { close: () => { dialog.onClose?.(); } };
      return handle;
    },
  };
  return { ui, shown };
}

const NOW = Date.parse("2026-10-21T10:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const lines: UpdatesOfferLines = {
  piWeb: { running: "2.202609.6", latest: "2.202609.7" },
  packages: [{ source: "npm:pi-tool", displayName: "pi-tool", kind: "npm", installed: "1.2.0", available: "1.3.0", state: "newer", serverPluginProcesses: [] }],
};

function ports(ui: Pick<PluginHostUi, "showDialog">, recorded: OfferAnswerWrites[]): UpdatesOfferDialogPorts {
  return {
    ui,
    machineName: "studio",
    updater: undefined,
    piWebAction: undefined,
    restartNote: undefined,
    record: (writes) => { recorded.push(writes); return Promise.resolve(); },
    notify: () => undefined,
    now: () => NOW,
  };
}

describe("the Updates on <machine> dialog", () => {
  it("records a one-day reminder for every line when the host closes it", async () => {
    const { ui, shown } = fakeUi();
    const recorded: OfferAnswerWrites[] = [];
    showUpdatesOffer(lines, ports(ui, recorded));

    shown[0]?.onClose?.();
    await Promise.resolve();

    expect(recorded).toEqual([{ remindAfter: NOW + DAY_MS, packagePairs: [] }]);
  });

  it("records the answer once, however many times the host closes it", async () => {
    const { ui, shown } = fakeUi();
    const recorded: OfferAnswerWrites[] = [];
    showUpdatesOffer(lines, ports(ui, recorded));
    const host = document.createElement("div");
    document.body.append(host);
    const dialog = shown[0];
    if (dialog === undefined) throw new Error("expected the dialog");
    render(dialog.content, host);

    [...host.querySelectorAll("button")].find((button) => button.textContent.trim() === "Don't remind me about these versions")?.click();
    shown[0]?.onClose?.();
    await Promise.resolve();
    host.remove();

    expect(recorded).toEqual([{ piWebVersion: "2.202609.7", packagePairs: ["npm:pi-tool@1.3.0"] }]);
  });

  it("names the machine and the versions it is offering", () => {
    const { ui, shown } = fakeUi();
    showUpdatesOffer(lines, ports(ui, []));
    const host = document.createElement("div");
    const dialog = shown[0];
    if (dialog === undefined) throw new Error("expected the dialog");
    render(dialog.content, host);

    const text = (line: Element, part: string) => line.querySelector(part)?.textContent.trim();
    expect({ label: dialog.label, lines: [...host.querySelectorAll("li.line")].map((line) => [text(line, ".title"), text(line, ".detail")]) }).toEqual({
      label: "Updates on studio",
      lines: [["PI WEB 2.202609.7", "running 2.202609.6"], ["pi-tool", "1.2.0 → 1.3.0 · npm"]],
    });
  });
});
