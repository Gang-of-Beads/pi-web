// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine, Project, Workspace } from "../../api";
import { AppContextSwitcher, type ContextSection } from "./AppContextSwitcher";

afterEach(() => {
  document.body.replaceChildren();
});

async function mount(configure: (element: AppContextSwitcher) => void = () => undefined): Promise<AppContextSwitcher> {
  const element = new AppContextSwitcher();
  configure(element);
  document.body.append(element);
  await element.updateComplete;
  return element;
}

function chips(element: AppContextSwitcher): HTMLButtonElement[] {
  return [...(element.shadowRoot?.querySelectorAll<HTMLButtonElement>(".chip") ?? [])];
}

function addButtons(element: AppContextSwitcher): HTMLButtonElement[] {
  return [...(element.shadowRoot?.querySelectorAll<HTMLButtonElement>(".add") ?? [])];
}

function machine(id: string): Machine {
  return { id, name: id, kind: id === "local" ? "local" : "remote", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" };
}

function project(id: string): Project {
  return { id, name: id, path: `/repo/${id}`, createdAt: "2026-08-01T00:00:00.000Z" };
}

function workspace(id: string): Workspace {
  return { id, projectId: "p", label: id, path: `/repo/${id}`, isMain: true, effectiveConfig: {} };
}

describe("app-context-switcher", () => {
  it("names the current project and workspace instead of listing them", async () => {
    const element = await mount((el) => {
      el.selectedProject = project("billing");
      el.selectedWorkspace = workspace("main");
    });

    const values = chips(element).map((chip) => chip.textContent.replace(/\s+/g, " ").trim());
    expect(values).toEqual(["Project billing", "Workspace main"]);
  });

  // The machine step is how a single-machine install reaches machine
  // management at all (rename the local machine, add a second one), so it
  // appears as soon as there is a machine, not only when there is a choice.
  it("shows the machine step whenever a machine exists, and none before that", async () => {
    const none = await mount((el) => { el.machines = []; });
    expect(chips(none)).toHaveLength(2);

    const one = await mount((el) => { el.machines = [machine("local")]; el.selectedMachine = machine("local"); });
    expect(chips(one)).toHaveLength(3);
    expect(chips(one)[0]?.textContent).toContain("Machine");

    const several = await mount((el) => { el.machines = [machine("local"), machine("remote-a")]; el.selectedMachine = machine("local"); });
    expect(chips(several)[0]?.textContent).toContain("Machine");
  });

  it("says Choose when a step has no value yet", async () => {
    const element = await mount();
    expect(chips(element)[0]?.textContent).toContain("Choose");
  });

  it("opens the picker for the step that was tapped", async () => {
    const onOpenSection = vi.fn<(section: ContextSection) => void>();
    const element = await mount((el) => { el.onOpenSection = onOpenSection; });

    chips(element)[0]?.click();

    expect(onOpenSection).toHaveBeenCalledWith("projects");
  });

  it("marks the open step so the body and the row agree", async () => {
    const element = await mount((el) => { el.openSection = "workspaces"; });
    const steps = [...(element.shadowRoot?.querySelectorAll(".step") ?? [])];
    expect(steps[1]?.classList.contains("open")).toBe(true);
    expect(chips(element)[1]?.getAttribute("aria-expanded")).toBe("true");
  });

  it("creates from the step it belongs to, without the command palette", async () => {
    const onAddProject = vi.fn<() => void>();
    const onAddMachine = vi.fn<() => void>();
    const element = await mount((el) => {
      el.machines = [machine("local"), machine("remote-a")];
      el.onAddProject = onAddProject;
      el.onAddMachine = onAddMachine;
    });

    const adds = addButtons(element);
    expect(adds.map((button) => button.getAttribute("aria-label"))).toEqual(["Add machine", "Add project"]);
    adds[1]?.click();
    expect(onAddProject).toHaveBeenCalledOnce();
    adds[0]?.click();
    expect(onAddMachine).toHaveBeenCalledOnce();
  });

  it("offers no create control for workspaces, which are provided rather than made here", async () => {
    const element = await mount();
    expect(addButtons(element).some((button) => button.getAttribute("aria-label")?.includes("workspace") === true)).toBe(false);
  });
});

describe("steps with nothing chosen yet", () => {
  it("says what each unset step would choose, because the label may be hidden", async () => {
    const element = await mount((instance) => {
      instance.machines = [machine("local")];
      instance.selectedMachine = machine("local");
    });

    const values = [...(element.shadowRoot?.querySelectorAll(".chip-value") ?? [])].map((node) => node.textContent);

    // Three steps sharing a 1440px bar are 103px each, under the 140px
    // container query that hides the label - so the first screen a new user
    // sees read "Local | Choose | Choose", with nothing saying which was the
    // project and which the workspace.
    expect(values).toEqual(["local", "Choose project", "Choose workspace"]);
  });

  it("shows the value itself once a step has one", async () => {
    const element = await mount((instance) => {
      instance.machines = [machine("local")];
      instance.selectedMachine = machine("local");
      instance.selectedProject = { id: "p1", name: "pi-web", path: "/repo", createdAt: "2026-08-01T00:00:00.000Z" };
    });

    const values = [...(element.shadowRoot?.querySelectorAll(".chip-value") ?? [])].map((node) => node.textContent);
    expect(values).toEqual(["local", "pi-web", "Choose workspace"]);
  });
});
