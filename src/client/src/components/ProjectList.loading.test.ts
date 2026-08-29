// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../api";
import { ProjectList } from "./ProjectList";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * The projects list rendered its array and nothing else: no loading, no
 * failure, no empty message. A failed load kept `[]`, so a project list that
 * could not be fetched rendered exactly like an empty one, and the failure
 * banner retired itself — the "project vanished" report. The list now carries
 * the load state, says what it is doing, and offers Retry on failure.
 */
describe("the project list knows whether its data is loaded", () => {
  it("shows a loading state before the first listing completes, not silence", async () => {
    const text = await mountedText({ projectsLoad: "unloaded" });
    expect(text).toContain("Loading projects");
  });

  it("shows a loading state while a listing is in flight", async () => {
    const text = await mountedText({ projectsLoad: "loading" });
    expect(text).toContain("Loading projects");
  });

  it("renders the failure with a Retry instead of a silent bare list", async () => {
    // RED before the discipline: a failed fetch rendered nothing at all.
    const text = await mountedText({ projectsLoad: "failed" });
    expect(text).toContain("Could not load projects");
    expect(text).toContain("Retry");
  });

  it("keeps stale rows on screen under the failure, with the Retry offered", async () => {
    const list = await mount({ projects: [project("kept")], projectsLoad: "failed" });
    const text = list.shadowRoot?.textContent ?? "";
    expect(text).toContain("kept");
    expect(text).toContain("Could not load projects");
  });

  it("says 'No projects yet' only on a loaded-empty list", async () => {
    const text = await mountedText({ projects: [], projectsLoad: "loaded" });
    expect(text).toContain("No projects yet");
    expect(text).not.toContain("Loading projects");
  });

  it("renders rows with no status line once loaded", async () => {
    const text = await mountedText({ projects: [project("a")], projectsLoad: "loaded" });
    expect(text).toContain("a");
    expect(text).not.toContain("Loading projects");
    expect(text).not.toContain("No projects yet");
  });

  it("offers Retry through the host handler", async () => {
    const onRetryLoad = vi.fn();
    const list = await mount({ projects: [], projectsLoad: "failed", onRetryLoad });
    const retry = [...(list.shadowRoot?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Retry");
    if (retry === undefined) throw new Error("Expected a Retry button");
    retry.click();
    expect(onRetryLoad).toHaveBeenCalledOnce();
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
  onRetryLoad?: () => void;
}

async function mount(options: MountOptions): Promise<ProjectList> {
  const list = new ProjectList();
  list.projects = options.projects ?? [];
  list.projectsLoad = options.projectsLoad ?? "loaded";
  if (options.onRetryLoad !== undefined) list.onRetryLoad = options.onRetryLoad;
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
  return { id, name: id, path: `/repo/${id}`, createdAt: "2026-06-04T00:00:00.000Z" };
}
