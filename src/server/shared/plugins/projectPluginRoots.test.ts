import { describe, expect, it, vi } from "vitest";
import { projectPluginRoots } from "./projectPluginRoots";
import { projectPluginDirectory } from "./projectPluginVerdict";

function inputFor(projects: readonly string[], trusted: (path: string) => boolean, withPluginDir: readonly string[]) {
  return {
    projectPaths: () => projects,
    agentDir: () => "/agent",
    directoryExists: (path: string) => withPluginDir.some((project) => projectPluginDirectory(project) === path),
    trustOf: (path: string) => ({ trusted: trusted(path) }),
  };
}

describe("resolving the projects whose own plugins may load", () => {
  it("offers a root for a trusted project that has plugins", async () => {
    const resolved = await projectPluginRoots(inputFor(["/trusted"], () => true, ["/trusted"]));

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.root?.path).toBe(projectPluginDirectory("/trusted"));
  });

  it("withholds an untrusted project rather than skipping it silently", async () => {
    const resolved = await projectPluginRoots(inputFor(["/untrusted"], () => false, ["/untrusted"]));

    expect(resolved[0]?.root).toBeUndefined();
    expect(resolved[0]?.withheld?.message).toContain("not trusted");
  });

  it("says nothing about a project with no plugin directory", async () => {
    const resolved = await projectPluginRoots(inputFor(["/plain"], () => true, []));

    expect(resolved).toEqual([]);
  });

  it("does not let a trusted project vouch for an untrusted sibling", async () => {
    const resolved = await projectPluginRoots(inputFor(["/trusted", "/untrusted"], (path) => path === "/trusted", ["/trusted", "/untrusted"]));

    expect(resolved.find((entry) => entry.directory.startsWith("/trusted"))?.root).toBeDefined();
    expect(resolved.find((entry) => entry.directory.startsWith("/untrusted"))?.root).toBeUndefined();
  });

  it("asks about each project once even when it is listed twice", async () => {
    const trustOf = vi.fn(() => ({ trusted: true }));

    await projectPluginRoots({
      projectPaths: () => ["/repo", "/repo"],
      agentDir: () => "/agent",
      directoryExists: () => true,
      trustOf,
    });

    expect(trustOf).toHaveBeenCalledTimes(1);
  });
});
