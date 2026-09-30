// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { NavProjectSnapshot as Project } from "@gang-of-beads/pi-web/plugin-api";
import { ProjectList } from "./ProjectList";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * The list claims an empty machine only after a listing answered with zero.
 * Before an answer it says nothing: the host retries a lost listing by itself
 * and its app row names a machine that stays unanswered (B48). It never shows
 * "Loading projects…" (owner, 2026-09-30) or a failure with Retry, which the
 * owner met frozen on the phone board after one lost answer.
 */
describe("the project list claims nothing it does not know", () => {
  it("says nothing before the first listing answers, or while one is in flight", async () => {
    for (const projectsLoad of ["unloaded", "loading"] as const) {
      const text = await mountedText({ projectsLoad });
      expect({ projectsLoad, loading: text.includes("Loading projects"), empty: text.includes("No projects yet"), failed: text.includes("Could not load") }).toEqual({ projectsLoad, loading: false, empty: false, failed: false });
    }
  });

  it("keeps the last known rows while a listing is in flight", async () => {
    const list = await mount({ projects: [project("kept")], projectsLoad: "loading" });
    expect(list.shadowRoot?.textContent).toContain("kept");
  });

  it("says 'No projects yet' only on a loaded-empty list", async () => {
    const text = await mountedText({ projects: [], projectsLoad: "loaded" });
    expect(text).toContain("No projects yet");
  });

  it("renders rows with no status line once loaded", async () => {
    const text = await mountedText({ projects: [project("a")], projectsLoad: "loaded" });
    expect(text).toContain("a");
    expect(text).not.toContain("No projects yet");
  });
});

describe("a query that hides project rows says so", () => {
  // Six projects is where the search field earns its place (PROJECT_SEARCH_MIN_PROJECTS);
  // every name contains "a" so the shared-token case below can match all six.
  const projects = ["alpha", "beta", "gamma", "delta", "lambda", "zeta"].map(project);

  it("shows the shown-of-total count while a query filters rows away", async () => {
    // The leftover query was the one producer that could hide exactly one
    // project while the others rendered — the eclipse report. Now it is named.
    const list = await mount({ projects, projectsLoad: "loaded" });
    setSearch(list, "alp");
    await list.updateComplete;

    const text = list.shadowRoot?.textContent ?? "";
    expect(text).toContain("1 of 6 projects shown");
  });

  it("shows no count when the query matches everything or there is no query", async () => {
    const list = await mount({ projects, projectsLoad: "loaded" });
    expect(list.shadowRoot?.textContent).not.toContain("of 6 projects shown");

    // A token every name contains hides nothing, so there is nothing to count.
    setSearch(list, "a");
    await list.updateComplete;
    expect(list.shadowRoot?.textContent).not.toContain("of 6 projects shown");
  });

  it("retires the query when the section is hidden, so a later visit starts unfiltered", async () => {
    // The component is hidden, not destroyed, when another section takes the
    // panel; a query surviving that switch silently filtered the next visit.
    // The observable undo: the filtered single row becomes the whole list.
    const list = await mount({ projects, projectsLoad: "loaded" });
    setSearch(list, "alpha");
    await list.updateComplete;
    expect(rowNames(list)).toEqual(["alpha"]);

    list.hidden = true;
    // Clearing the query inside updated() schedules one more render; let both
    // settle before reading the rows.
    await list.updateComplete;
    await list.updateComplete;
    expect(rowNames(list)).toEqual(["alpha", "beta", "gamma", "delta", "lambda", "zeta"]);
  });
});

function rowNames(list: ProjectList): string[] {
  return [...(list.shadowRoot?.querySelectorAll(".workspace-primary-label") ?? [])].map((label) => label.textContent.trim());
}

interface MountOptions {
  projects?: Project[];
  projectsLoad?: "unloaded" | "loading" | "loaded" | "failed";
}

async function mount(options: MountOptions): Promise<ProjectList> {
  const list = new ProjectList();
  list.projects = options.projects ?? [];
  list.projectsLoad = options.projectsLoad ?? "loaded";
  document.body.append(list);
  await list.updateComplete;
  return list;
}

async function mountedText(options: MountOptions): Promise<string> {
  const list = await mount(options);
  return list.shadowRoot?.textContent ?? "";
}

function setSearch(list: ProjectList, query: string): void {
  const input = list.shadowRoot?.querySelector<HTMLInputElement>(".list-search-input");
  if (input === null || input === undefined) throw new Error("Expected the project search field to be rendered");
  input.value = query;
  input.dispatchEvent(new Event("input"));
}

function project(id: string): Project {
  return { id, name: id, path: `/repo/${id}` };
}
