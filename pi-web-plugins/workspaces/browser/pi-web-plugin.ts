import { html, type TemplateResult } from "lit";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import type { NavSectionContribution, NavSectionContext, PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { ProjectList } from "./ProjectList";
import { WorkspaceList } from "./WorkspaceList";

/**
 * The projects and workspaces pickers as a plugin. The shell reserves the
 * slots and keeps the section order, the keyboard machine, and the collapse
 * state; this module renders the bodies and focuses them on the shell's
 * behalf. Both switcher surfaces — the desktop navigation panel and the phone
 * context sheet — draw these same sections.
 */

const projectsListRef: Ref<ProjectList> = createRef();
const workspacesListRef: Ref<WorkspaceList> = createRef();

function renderProjectsSection(context: NavSectionContext): TemplateResult {
  const display = context.display;
  return html`<project-list
    ${ref(projectsListRef)}
    .hidden=${display.hidden}
    .projects=${context.projects}
    .projectsLoad=${context.projectsLoad}
    .onRetryLoad=${() => { context.retryProjectsLoad(); }}
    .selected=${context.projects.find((project) => project.id === context.selectedProjectId)}
    .statusSnapshot=${context.statusSnapshot}
    .collapsible=${display.collapsible}
    .collapsed=${display.collapsed}
    .onToggleCollapsed=${() => { context.toggleCollapsed(); }}
    .onAdd=${context.addProject === undefined ? undefined : () => { context.addProject?.(); }}
    .onSelect=${(project: NavSectionContext["projects"][number]) => { context.selectProject(project.id); }}
    .onClose=${context.closeProject === undefined ? undefined : (project: NavSectionContext["projects"][number]) => { context.closeProject?.(project.id); }}
    .onFocusPreviousSection=${() => { void context.focusPreviousSection(); }}
    .onFocusNextSection=${() => { void context.focusNextSection(); }}
    .onCancelKeyboardNavigation=${() => { void context.cancelKeyboardNavigation(); }}
    .tiles=${display.tiles}
  ></project-list>`;
}

function renderWorkspacesSection(context: NavSectionContext): TemplateResult {
  const display = context.display;
  const selected = context.workspaces.find((workspace) => workspace.id === context.selectedWorkspaceId);
  return html`<workspace-list
    ${ref(workspacesListRef)}
    .hidden=${display.hidden}
    .workspaces=${context.workspaces}
    .selected=${selected}
    .statusSnapshot=${context.statusSnapshot}
    .deletingWorkspaceIds=${context.deletingWorkspaceIds}
    .workspaceLabelItems=${(workspace: NavSectionContext["workspaces"][number]) => context.labelItems(workspace.id)}
    .workspaceTrust=${context.workspaceTrust}
    .collapsible=${display.collapsible}
    .collapsed=${display.collapsed}
    .onToggleCollapsed=${() => { context.toggleCollapsed(); }}
    .onSelect=${(workspace: NavSectionContext["workspaces"][number]) => { context.selectWorkspace(workspace.id); }}
    .onDelete=${context.deleteWorkspace === undefined ? undefined : (workspace: NavSectionContext["workspaces"][number]) => { context.deleteWorkspace?.(workspace.id); }}
    .onFocusPreviousSection=${() => { void context.focusPreviousSection(); }}
    .onFocusNextSection=${() => { void context.focusNextSection(); }}
    .onCancelKeyboardNavigation=${() => { void context.cancelKeyboardNavigation(); }}
    .tiles=${display.tiles}
  ></workspace-list>`;
}

export function workspacesNavSections(): NavSectionContribution[] {
  return [
    {
      id: "projects",
      order: 10,
      focus: async () => await projectsListRef.value?.focusSelectedOrFirst() ?? false,
      render: renderProjectsSection,
    },
    {
      id: "workspaces",
      order: 20,
      focus: async () => await workspacesListRef.value?.focusSelectedOrFirst() ?? false,
      render: renderWorkspacesSection,
    },
  ];
}

const workspacesPlugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Workspaces",
  activate: () => ({
    contributions: {
      navSections: workspacesNavSections(),
    },
  }),
};

export default workspacesPlugin;
