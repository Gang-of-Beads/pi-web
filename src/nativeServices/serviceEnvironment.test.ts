import { describe, expect, it } from "vitest";
import { hostingServiceId } from "./serviceEnvironment";
import { DEPLOYMENT_SERVICE_ENVIRONMENT_KEYS, deploymentServiceEnvironment } from "./serviceEnvironment.js";

describe("deploymentServiceEnvironment", () => {
  it("carries the deployment variables a service cannot rediscover", () => {
    expect(deploymentServiceEnvironment({
      PI_WEB_UPDATE_COMMAND: "/home/u/nix-config/scripts/pi-web-update.sh --force astra-mbp",
      PI_WEB_UPDATE_REPO: "/home/u/src/pi-web",
    })).toEqual({
      PI_WEB_UPDATE_COMMAND: "/home/u/nix-config/scripts/pi-web-update.sh --force astra-mbp",
      PI_WEB_UPDATE_REPO: "/home/u/src/pi-web",
    });
  });

  it("omits unset and blank values so an empty assignment cannot shadow a resolvable one", () => {
    expect(deploymentServiceEnvironment({ PI_WEB_UPDATE_COMMAND: "", PI_WEB_UPDATE_REPO: "   " })).toEqual({});
    expect(deploymentServiceEnvironment({})).toEqual({});
  });

  it("leaves one-off shell state out of long-lived service files", () => {
    // A port, a session marker or a scratch data directory belongs to the shell
    // that happened to run the installer, not to the installed deployment.
    expect(deploymentServiceEnvironment({
      PI_WEB_PORT: "8599",
      PI_WEB_SESSION: "1",
      PI_WEB_DATA_DIR: "/tmp/scratch",
      PI_WEB_UPDATE_COMMAND: "update.sh",
    })).toEqual({ PI_WEB_UPDATE_COMMAND: "update.sh" });
  });

  it("keeps the captured set explicit", () => {
    expect([...DEPLOYMENT_SERVICE_ENVIRONMENT_KEYS]).toEqual(["PI_WEB_UPDATE_COMMAND", "PI_WEB_UPDATE_REPO"]);
  });
});

describe("which service the running command sits inside", () => {
  /**
   * A self-update started from the pi-web UI runs in the session daemon, so a
   * restart that tore the daemon down killed the updater before it could start
   * anything again. Naming the host is what lets the restart avoid that.
   *
   * PI_WEB_SESSION is set for every process spawned from a pi-web session, so
   * it is the signal that the command is inside the session daemon.
   */
  it("names the session daemon for a command spawned from a session", () => {
    expect(hostingServiceId({ PI_WEB_SESSION: "1" })).toBe("sessiond");
  });

  it("names nothing for a command run from an ordinary shell", () => {
    expect(hostingServiceId({})).toBe(undefined);
  });

  it("treats an empty value as not being inside a session", () => {
    expect(hostingServiceId({ PI_WEB_SESSION: "" })).toBe(undefined);
  });
});
