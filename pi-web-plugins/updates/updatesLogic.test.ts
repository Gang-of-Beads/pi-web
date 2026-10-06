import { describe, expect, it } from "vitest";
import type { PiWebComponentStatus, PiWebStatusMessage, PiWebStatusResponse, PluginRuntimeState } from "@gang-of-beads/pi-web/plugin-api";
import { fallbackDockerStatus, formatVersion, installationLabel, messageCount, shouldShowUpdatesPanel } from "./updatesLogic";

function component(overrides: Partial<PiWebComponentStatus> = {}): PiWebComponentStatus {
  return {
    component: "web",
    label: "Web/UI",
    runtimeVersion: "1.202605.8",
    installedVersion: "1.202605.8",
    stale: false,
    available: true,
    ...overrides,
  };
}

function status(overrides: Partial<PiWebStatusResponse> = {}): PiWebStatusResponse {
  return {
    packageName: "@gang-of-beads/pi-web",
    generatedAt: "2026-06-14T00:00:00.000Z",
    components: {
      web: component({ component: "web", label: "Web/UI" }),
      sessiond: component({ component: "sessiond", label: "Session daemon" }),
    },
    release: { packageName: "@gang-of-beads/pi-web", updateAvailable: false },
    commands: {},
    messages: [],
    ...overrides,
  };
}

function stateWith(value: PiWebStatusResponse | undefined): PluginRuntimeState {
  return value === undefined ? {} : { piWebStatus: value };
}

describe("shouldShowUpdatesPanel", () => {
  const messages: PiWebStatusMessage[] = [{ id: "x", severity: "warning", title: "t", body: "b" }];

  it("shows the panel whenever there are messages, even on a managed install", () => {
    const value = status({
      messages,
      components: {
        web: component({ installation: { kind: "pi-package" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon", installation: { kind: "pi-package" } }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(value))).toBe(true);
  });

  it("shows the panel when a federated Docker runtime hint is available before status is parsed", () => {
    expect(shouldShowUpdatesPanel(undefined, { dockerMode: "dev" })).toBe(true);
    expect(shouldShowUpdatesPanel(undefined, { dockerMode: "runtime" })).toBe(true);
  });

  it("hides the panel when status is unavailable", () => {
    expect(shouldShowUpdatesPanel(stateWith(undefined))).toBe(false);
    expect(shouldShowUpdatesPanel(undefined)).toBe(false);
  });

  it("shows the panel for local, Docker, or unknown installs", () => {
    const local = status({
      components: {
        web: component({ installation: { kind: "local" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon", installation: { kind: "pi-package" } }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(local))).toBe(true);

    const docker = status({
      components: {
        web: component({ installation: { kind: "docker", dockerMode: "runtime" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon", installation: { kind: "docker", dockerMode: "runtime" } }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(docker))).toBe(true);

    const unknown = status({
      components: {
        web: component({ installation: { kind: "pi-package" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon" }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(unknown))).toBe(true);
  });

  it("hides the panel for fully managed installs with no messages", () => {
    const value = status({
      components: {
        web: component({ installation: { kind: "pi-package" } }),
        sessiond: component({ component: "sessiond", label: "Session daemon", installation: { kind: "npm-global" } }),
      },
    });
    expect(shouldShowUpdatesPanel(stateWith(value))).toBe(false);
  });
});

describe("fallbackDockerStatus", () => {
  it("creates Docker development commands from a federated runtime hint", () => {
    const fallback = fallbackDockerStatus({ dockerMode: "dev" }, "generated");
    expect(fallback?.generatedAt).toBe("generated");
    expect(fallback?.components.web.installation).toEqual({ kind: "docker", dockerMode: "dev" });
    expect(fallback?.commands).toEqual({
      update: "pi-web-docker --dev update",
      restart: "pi-web-docker --dev restart",
      restartWeb: "pi-web-docker --dev restart-web",
      restartSessiond: "pi-web-docker --dev restart-sessiond",
      status: "pi-web-docker --dev status",
    });
    expect(fallback?.messages[0]?.id).toBe("docker-status-compatibility");
  });

  it("creates Docker runtime commands without the development prefix", () => {
    const fallback = fallbackDockerStatus({ dockerMode: "runtime" });
    expect(fallback?.components.sessiond.installation).toEqual({ kind: "docker", dockerMode: "runtime" });
    expect(fallback?.commands).toEqual({
      update: "pi-web-docker update",
      restart: "pi-web-docker restart",
      restartWeb: "pi-web-docker restart-web",
      restartSessiond: "pi-web-docker restart-sessiond",
      status: "pi-web-docker status",
    });
  });

  it("does not create a fallback without a Docker runtime hint", () => {
    expect(fallbackDockerStatus({})).toBeUndefined();
  });
});

describe("messageCount", () => {
  it("counts messages and tolerates missing status", () => {
    expect(messageCount(undefined)).toBe(0);
    expect(messageCount(stateWith(status()))).toBe(0);
    expect(messageCount(stateWith(status({ messages: [{ id: "a", severity: "info", title: "t", body: "b" }] })))).toBe(1);
  });
});

describe("formatVersion", () => {
  it("renders unknown for missing or empty versions", () => {
    expect(formatVersion(undefined)).toBe("unknown");
    expect(formatVersion("")).toBe("unknown");
    expect(formatVersion("1.202605.8")).toBe("1.202605.8");
  });
});

describe("installationLabel", () => {
  it("labels each installation kind", () => {
    expect(installationLabel(undefined)).toBe("installation unknown");
    expect(installationLabel({ kind: "unknown" })).toBe("installation unknown");
    expect(installationLabel({ kind: "unknown", manager: "nix" })).toBe("nix");
    expect(installationLabel({ kind: "npm-global" })).toBe("global npm package");
    expect(installationLabel({ kind: "local" })).toBe("local checkout");
    expect(installationLabel({ kind: "docker", dockerMode: "runtime" })).toBe("Docker runtime");
    expect(installationLabel({ kind: "docker", dockerMode: "dev" })).toBe("Docker development runtime");
  });

  it("includes source and scope for pi-package installs", () => {
    expect(installationLabel({ kind: "pi-package", source: "npm:@gang-of-beads/pi-web", scope: "user" }))
      .toBe("npm:@gang-of-beads/pi-web · user");
  });

  it("defaults the source and omits scope when absent", () => {
    expect(installationLabel({ kind: "pi-package" })).toBe("Pi package");
  });
});
