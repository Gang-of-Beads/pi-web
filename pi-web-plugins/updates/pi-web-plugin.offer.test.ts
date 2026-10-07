// @vitest-environment happy-dom
import { html, render, svg } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginDialog } from "@gang-of-beads/pi-web/plugin-api";
import { createPluginHostUi } from "../../src/client/src/plugins/pluginHostUi.js";
import plugin from "./pi-web-plugin.js";

/**
 * The offer read a top-level `version` the status never carries, so it stayed silent on every
 * machine from the day it shipped (fd56eb53). This drives the plugin from a status shaped like a
 * real `pi-web/status` answer to the popup a reader sees and the page it opens: the popup hands out
 * no command (owner, 2026-10-07); the Updates page runs it as a button.
 */
describe("the updates plugin offers a newer PI WEB", () => {
  afterEach(() => { document.body.replaceChildren(); });

  it("opens the offer for a newer release, opens the Updates page from it, and records the answer", async () => {
    const dialogs: PluginDialog[] = [];
    const opened: string[] = [];
    const ui = createPluginHostUi({ showDialog: (dialog) => { dialogs.push(dialog); return { close: () => undefined }; } });
    const openPage = (pageId: string) => { opened.push(pageId); };
    const readPiWebStatus = () => Promise.resolve({
      packageName: "@gang-of-beads/pi-web",
      generatedAt: "2026-10-01T14:09:11.652Z",
      components: { web: { component: "web", runtimeVersion: "2.202609.28", installedVersion: "2.202609.28" } },
      release: { latestVersion: "2.202610.1", updateAvailable: true },
      commands: { update: "pi-web update" },
    });
    const operations: unknown[] = [];
    const callOperation = (operation: string, input?: unknown) => {
      operations.push(input === undefined ? operation : [operation, input]);
      return Promise.resolve({ answeredVersions: [] });
    };
    const fetchJson = () => Promise.reject(new Error("the host fact answers"));

    plugin.activate({ apiVersion: 2, pluginId: "updates", runtimePluginId: "updates", html, svg, fetchJson, callOperation, ui, readPiWebStatus, openPage });
    await vi.waitFor(() => { expect(dialogs).toHaveLength(1); });
    const dialog = dialogs[0];
    if (dialog === undefined) throw new Error(`expected the offer, got ${String(dialogs.length)} dialogs`);
    const host = document.createElement("div");
    document.body.append(host);
    render(dialog.content, host);
    const open = [...host.querySelectorAll("button")].find((button) => button.textContent.trim() === "Open Updates");
    open?.click();
    await vi.waitFor(() => { expect(operations).toHaveLength(2); });

    expect({ label: dialog.label, opened, operations, commandShown: host.textContent.includes("pi-web update") }).toEqual({
      label: "Update PI WEB 2.202609.28 to 2.202610.1",
      opened: ["updates:global.updates"],
      commandShown: false,
      operations: ["offer.answered", ["offer.answer", { version: "2.202610.1" }]],
    });
  });
});
