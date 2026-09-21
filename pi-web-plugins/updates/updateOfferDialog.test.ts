import { html } from "lit";
import { describe, expect, it } from "vitest";
import type { PluginDialog, PluginDialogHandle, PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";
import { showPiWebUpdateOffer } from "./updateOfferDialog";

/**
 * Owner's ruling: one popup for PI WEB, and closing it answers it. A dialog dismissed with no
 * record is what brought the same version back in the next session.
 */
function fakeUi() {
  const shown: PluginDialog[] = [];
  const closes: number[] = [];
  const ui: Pick<PluginHostUi, "showDialog"> = {
    showDialog: (dialog) => {
      shown.push(dialog);
      const handle: PluginDialogHandle = { close: () => { closes.push(1); dialog.onClose?.(); } };
      return handle;
    },
  };
  return { ui, shown, closes };
}

describe("the PI WEB update offer dialog", () => {
  it("records a dismissal when the host closes it", async () => {
    const { ui, shown } = fakeUi();
    const answers: { version: string; answer: string }[] = [];
    showPiWebUpdateOffer({ running: "2.202609.6", latest: "2.202609.7", command: "npm run build" }, {
      ui,
      html,
      answer: (version) => { answers.push({ version, answer: "dismissed" }); return Promise.resolve(); },
      copy: () => Promise.resolve(true),
      notify: () => undefined,
    });

    shown[0]?.onClose?.();
    await Promise.resolve();

    expect(answers).toEqual([{ version: "2.202609.7", answer: "dismissed" }]);
  });

  it("records the answer once, however many times the host closes it", async () => {
    const { ui, shown } = fakeUi();
    const answers: string[] = [];
    showPiWebUpdateOffer({ running: "2.202609.6", latest: "2.202609.7", command: "npm run build" }, {
      ui,
      html,
      answer: () => { answers.push("dismissed"); return Promise.resolve(); },
      copy: () => Promise.resolve(true),
      notify: () => undefined,
    });

    shown[0]?.onClose?.();
    shown[0]?.onClose?.();
    await Promise.resolve();

    expect(answers).toEqual(["dismissed"]);
  });

  it("names the versions it is offering", () => {
    const { ui, shown } = fakeUi();
    showPiWebUpdateOffer({ running: "2.202609.6", latest: "2.202609.7", command: "npm run build" }, {
      ui,
      html,
      answer: () => Promise.resolve(),
      copy: () => Promise.resolve(true),
      notify: () => undefined,
    });

    expect(shown[0]?.label).toBe("Update PI WEB 2.202609.6 to 2.202609.7");
  });
});
