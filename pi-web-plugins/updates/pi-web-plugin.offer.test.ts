// @vitest-environment happy-dom
import { html, render, svg } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginDialog } from "@gang-of-beads/pi-web/plugin-api";
import { createPluginHostUi } from "../../src/client/src/plugins/pluginHostUi.js";
import plugin from "./pi-web-plugin.js";

/**
 * The offer read a top-level `version` the status never carries, so it stayed silent on every
 * machine from the day it shipped (fd56eb53). This drives the plugin from a status shaped like a
 * real `pi-web/status` answer to the "Updates on <machine>" popup a reader sees: PI WEB's own update
 * and a pi package update in one dialog (owner, 2026-10-21), a package updated inline through the
 * machine's core route, and the versions settled by "Don't remind me". No command is handed out.
 */
describe("the updates plugin offers a newer PI WEB and pi packages", () => {
  afterEach(() => { document.body.replaceChildren(); });

  it("opens one dialog for both kinds, updates a package through the machine's route, and records the versions", async () => {
    const dialogs: PluginDialog[] = [];
    const ui = createPluginHostUi({ showDialog: (dialog) => { dialogs.push(dialog); return { close: () => { dialog.onClose?.(); } }; } });
    const readPiWebStatus = () => Promise.resolve({
      packageName: "@gang-of-beads/pi-web",
      generatedAt: "2026-10-01T14:09:11.652Z",
      components: { web: { component: "web", runtimeVersion: "2.202609.28", installedVersion: "2.202609.28" } },
      release: { latestVersion: "2.202610.1", updateAvailable: true },
      commands: { update: "pi-web update" },
      piPackages: {
        listing: "listed",
        checkedAt: "2026-10-01T14:00:00.000Z",
        checking: false,
        packages: [
          { source: "npm:pi-tool", displayName: "pi-tool", kind: "npm", installed: "1.2.0", available: "1.3.0", state: "newer", serverPluginProcesses: [] },
          { source: "npm:pi-pinned@1.0.0", displayName: "pi-pinned", kind: "npm", installed: "1.0.0", state: "pinned", serverPluginProcesses: [] },
        ],
      },
    });
    const operations: unknown[] = [];
    const callOperation = (operation: string, input?: unknown) => {
      operations.push(input === undefined ? operation : [operation, input]);
      return Promise.resolve({ answeredVersions: [], answeredPackages: [], packagesEnabled: true });
    };
    const posted: unknown[] = [];
    const fetchJson = (path: string, init?: { method?: string; body?: unknown }) => { posted.push([path, init]); return Promise.resolve({ action: "update", packages: [] }); };

    plugin.activate({ apiVersion: 2, pluginId: "updates", runtimePluginId: "updates", html, svg, fetchJson, callOperation, ui, readPiWebStatus, openPage: () => undefined });
    await vi.waitFor(() => { expect(dialogs).toHaveLength(1); });
    const dialog = dialogs[0];
    if (dialog === undefined) throw new Error(`expected the offer, got ${String(dialogs.length)} dialogs`);
    const host = document.createElement("div");
    document.body.append(host);
    render(dialog.content, host);
    const button = (label: string) => [...host.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === label);
    const packageLine = [...host.querySelectorAll("li")].find((line) => line.textContent.includes("pi-tool"));
    packageLine?.querySelector("button")?.click();
    await vi.waitFor(() => { expect([...host.querySelectorAll("li")].find((line) => line.textContent.includes("pi-tool"))?.querySelector(".status")?.textContent).toBe("updated"); });
    button("Don't remind me about these versions")?.click();
    await vi.waitFor(() => { expect(operations).toHaveLength(3); });

    expect({ label: dialog.label, posted, operations, commandShown: host.textContent.includes("pi-web update"), pinnedOffered: host.textContent.includes("pi-pinned") }).toEqual({
      label: "Updates on this machine",
      posted: [["api/machines/local/pi-packages/update", { method: "POST", body: { source: "npm:pi-tool" } }]],
      commandShown: false,
      pinnedOffered: false,
      operations: ["offer.read", ["offer.answer", { version: "2.202610.1" }], ["offer.answer-packages", { pairs: ["npm:pi-tool@1.3.0"] }]],
    });
  });
});
