import { describe, expect, it } from "vitest";
import { directMachinesOf, directMachineUrl } from "./directMachineUrl";
import type { Machine } from "../../shared/apiTypes";

const machine = (overrides: Partial<Machine>): Machine => ({
  id: "m1",
  name: "hxd-k12",
  kind: "remote",
  baseUrl: "https://k12.example:8504",
  connectFrom: "browser",
  createdAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z",
  ...overrides,
});

describe("the direct roster", () => {
  it("carries the machine's access token, which a cross-origin fetch has no cookie for", () => {
    expect(directMachinesOf([machine({ accessToken: "secret" })]).get("m1")).toEqual({ baseUrl: "https://k12.example:8504", accessToken: "secret" });
  });

  it("leaves a machine reached through the server out, and carries no token it does not have", () => {
    expect(directMachinesOf([machine({ connectFrom: "server", accessToken: "secret" })]).size).toBe(0);
    expect(directMachinesOf([machine({})]).get("m1")).toEqual({ baseUrl: "https://k12.example:8504" });
  });
});

describe("a direct machine's URL", () => {
  it("carries the machine's token in its path, so a socket, an image and a module's own imports are all answered", () => {
    const machines = directMachinesOf([machine({ accessToken: "a/b+c=" })]);
    expect(directMachineUrl("api/machines/m1/sessions?cwd=%2Fa", machines)).toBe("https://k12.example:8504/access-token/a%2Fb%2Bc%3D/api/sessions?cwd=%2Fa");
    expect(directMachineUrl("api/machines/m1/pi-web-plugins/x/index.js", machines)).toBe("https://k12.example:8504/access-token/a%2Fb%2Bc%3D/pi-web-plugins/x/index.js");
    expect(directMachineUrl("api/machines/m1", machines)).toBeUndefined();
    expect(directMachineUrl("api/machines/m1/health", directMachinesOf([machine({})]))).toBe("https://k12.example:8504/api/machines/local/health");
  });
});
