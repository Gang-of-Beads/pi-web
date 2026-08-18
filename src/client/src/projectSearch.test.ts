import { describe, expect, it } from "vitest";
import type { Project } from "./api";
import { filterProjects, shouldShowProjectSearch } from "./projectSearch";

const projects: Project[] = [
  project("pi-web-mobile", "/repo/pi-web-mobile"),
  project("pi-web-upstream", "/repo/pi-web-upstream"),
  project("notes", "/home/me/notes"),
];

describe("filterProjects", () => {
  it("returns everything for a blank query", () => {
    expect(filterProjects(projects, "  ")).toEqual(projects);
  });

  it("matches fragments in any order", () => {
    // Neither ordering is a contiguous substring of the project's text.
    expect(filterProjects(projects, "mobile web").map((p) => p.name)).toEqual(["pi-web-mobile"]);
    expect(filterProjects(projects, "web mobile").map((p) => p.name)).toEqual(["pi-web-mobile"]);
  });

  it("searches the path as well as the name", () => {
    expect(filterProjects(projects, "home me").map((p) => p.name)).toEqual(["notes"]);
  });

  it("keeps every project that satisfies the query", () => {
    expect(filterProjects(projects, "pi-web").map((p) => p.name)).toEqual(["pi-web-mobile", "pi-web-upstream"]);
  });

  it("is case insensitive", () => {
    expect(filterProjects(projects, "NOTES").map((p) => p.name)).toEqual(["notes"]);
  });

  it("returns nothing when no project matches", () => {
    expect(filterProjects(projects, "gemini")).toEqual([]);
  });
});

describe("shouldShowProjectSearch", () => {
  it("stays hidden for a list short enough to scan", () => {
    expect(shouldShowProjectSearch(3, "")).toBe(false);
  });

  it("appears once the list is long enough to be a nuisance", () => {
    expect(shouldShowProjectSearch(6, "")).toBe(true);
  });

  it("stays visible while a query is active, however short the list", () => {
    // Hiding the field with text still in it would strand the filter with no
    // way to clear it.
    expect(shouldShowProjectSearch(1, "web")).toBe(true);
  });
});

function project(name: string, path: string): Project {
  return { id: name, name, path, createdAt: "2026-08-18T00:00:00.000Z" };
}
