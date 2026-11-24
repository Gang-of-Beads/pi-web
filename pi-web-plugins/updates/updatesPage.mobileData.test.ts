import { describe, expect, it, vi } from "vitest";
import type { PiWebStatusResponse } from "@gang-of-beads/pi-web/plugin-api";
import { updatesPageModel, type UpdatesPageActions } from "./updatesPage";

function status(): PiWebStatusResponse {
  return {
    packageName: "@gang-of-beads/pi-web",
    generatedAt: "2026-11-24T00:00:00.000Z",
    components: {
      web: { component: "web", label: "Web/UI", runtimeVersion: "1.0.0", installedVersion: "1.0.0", stale: false, available: true },
      sessiond: { component: "sessiond", label: "Session daemon", runtimeVersion: "1.0.0", installedVersion: "1.0.0", stale: false, available: true },
    },
    release: { packageName: "@gang-of-beads/pi-web", updateAvailable: true, latestVersion: "2.0.0" },
    commands: { update: "pi-web update" },
    messages: [],
  };
}

function actions(overrides: Partial<UpdatesPageActions> = {}): UpdatesPageActions {
  return {
    check: () => undefined,
    checking: false,
    update: () => undefined,
    restart: undefined,
    setUpdateCommand: undefined,
    piPackages: { updater: undefined, rowControls: false, popupEnabled: undefined, popupSave: "settled", togglePopup: undefined },
    mobileData: "ask",
    setMobileData: () => undefined,
    metered: false,
    ...overrides,
  };
}

const rowOf = (model: ReturnType<typeof updatesPageModel>, id: string) =>
  model.groups.flatMap((group) => group.rows).find((row) => row.id === id);

describe("the mobile-data row", () => {
  it("names the current choice and offers the other two", () => {
    const setMobileData = vi.fn();
    const model = updatesPageModel(status(), actions({ setMobileData }), () => undefined);

    expect(rowOf(model, "mobile-data")?.value).toBe("Ask first");
    const group = model.groups.find((entry) => entry.id === "downloads");
    expect(group?.actions?.map((action) => action.id)).toEqual(["mobile-auto", "mobile-never"]);

    group?.actions?.[1]?.run();
    expect(setMobileData).toHaveBeenCalledWith("never");
  });

  it("says when the device is on mobile data, and when it is not", () => {
    const onMobile = updatesPageModel(status(), actions({ metered: true }), () => undefined);
    expect(rowOf(onMobile, "mobile-data")?.detail).toMatch(/This device is on mobile data/);
    const wired = updatesPageModel(status(), actions({ metered: false }), () => undefined);
    expect(rowOf(wired, "mobile-data")?.detail).not.toMatch(/This device is on mobile data/);
  });
});

describe("the update button on mobile data", () => {
  it("says the download uses mobile data when the choice is to wait for Wi-Fi", () => {
    const model = updatesPageModel(status(), actions({ mobileData: "never", metered: true }), () => undefined);
    expect(model.groups.find((group) => group.id === "pi-web")?.actions?.find((action) => action.id === "update")?.label)
      .toBe("Update to 2.0.0 on mobile data");
  });

  it("keeps the plain label when the download is free to proceed", () => {
    for (const overrides of [{ mobileData: "auto" as const, metered: true }, { mobileData: "never" as const, metered: false }]) {
      const model = updatesPageModel(status(), actions(overrides), () => undefined);
      expect(model.groups.find((group) => group.id === "pi-web")?.actions?.find((action) => action.id === "update")?.label)
        .toBe("Update to 2.0.0");
    }
  });
});
