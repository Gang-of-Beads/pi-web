import { describe, expect, it } from "vitest";
import { piWebDockerCommand, piWebDockerCommandPrefix } from "./piWebDockerCommandPlan.js";

describe("pi-web-docker command wording", () => {
  it("emits runtime commands by default and development commands explicitly", () => {
    expect(piWebDockerCommandPrefix(undefined)).toBe("pi-web-docker");
    expect(piWebDockerCommandPrefix("runtime")).toBe("pi-web-docker");
    expect(piWebDockerCommandPrefix("dev")).toBe("pi-web-docker --dev");
    expect(piWebDockerCommand(undefined, "status")).toBe("pi-web-docker status");
    expect(piWebDockerCommand("runtime", "update")).toBe("pi-web-docker update");
    expect(piWebDockerCommand("dev", "status")).toBe("pi-web-docker --dev status");
  });
});
