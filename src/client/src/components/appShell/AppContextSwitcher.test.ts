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

  it("hides the machine step until there is a machine to choose between", async () => {
    const one = await mount((el) => { el.machines = [machine("local")]; });
    expect(chips(one)).toHaveLength(2);

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
