import { describe, expect, it } from "vitest";
import { filterMachines, filterWorkspaces, shouldShowContextSearch } from "./contextSearch";

/**
 * Projects and sessions could be searched; machines and workspaces could not.
 * A project with dozens of worktrees listed every branch as a tile, and
 * finding one meant scrolling past all of them - the one list where scrolling
 * is least useful, because branch names differ in the middle rather than at
 * the start.
 *
 * The same fuzzy rules the other two lists use: per token, order-independent,
 * so "acp fac" finds "feat/acp-facade".
 */
describe("searching workspaces", () => {
  const workspaces = [
    { id: "1", label: "feat/acp-facade", path: "/repo/wt/acp" },
    { id: "2", label: "fix/2124-runs-session-scope", path: "/repo/wt/2124" },
    { id: "3", label: "main", path: "/repo" },
  ];

  it("finds a branch by fragments in any order", () => {
    expect(filterWorkspaces(workspaces, "acp fac").map((w) => w.id)).toEqual(["1"]);
  });

  it("finds a branch by its number", () => {
    expect(filterWorkspaces(workspaces, "2124").map((w) => w.id)).toEqual(["2"]);
  });

  it("searches the path too, since a worktree is told apart by where it is", () => {
    expect(filterWorkspaces(workspaces, "wt/2124").map((w) => w.id)).toEqual(["2"]);
  });

  it("returns everything for an empty query", () => {
    expect(filterWorkspaces(workspaces, "   ")).toHaveLength(3);
  });
});

describe("searching machines", () => {
  const machines = [
    { id: "a", name: "hxd-work-mbp" },
    { id: "b", name: "astra-mbp" },
  ];

  it("finds a machine by a fragment", () => {
    expect(filterMachines(machines, "astra").map((m) => m.id)).toEqual(["b"]);
  });
});

describe("when the search box earns its place", () => {
  /**
   * A box above three items costs more than it saves; above thirty it is the
   * only way in. It also stays while a query is active, so a search that
   * matches nothing can still be cleared.
   */
  it("stays out of the way of a short list", () => {
    expect(shouldShowContextSearch(3, "")).toBe(false);
  });

  it("appears once the list is long enough to scroll", () => {
    expect(shouldShowContextSearch(12, "")).toBe(true);
  });

  it("stays while a query is active, however few match", () => {
    expect(shouldShowContextSearch(1, "acp")).toBe(true);
  });
});
