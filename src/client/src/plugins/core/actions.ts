import { isSessionActive } from "../../../../shared/activity";
import type { AppState } from "../../appState";
import { isArchivableSessionInfo, isTransientNewSessionInfo } from "../../sessionPersistence";
import { canDeleteWorkspace, isWorkspaceDeletionPending } from "../../workspaceDeletion";
import type { PluginAction } from "../types";

export function createCoreActions(): PluginAction[] {
  return [
    {
      id: "actions.show",
      title: "Show actions",
      description: "Open the command palette",
      shortcut: "mod+k",
      group: "General",
      run: (context) => { context.openActionPalette(); },
    },
    {
      id: "prompt.focus",
      title: "Focus prompt",
      description: "Move keyboard focus to the message composer",
      shortcut: "mod+g c",
      group: "General",
      run: (context) => { context.focusPrompt(); },
    },
    {
      id: "machine.add",
      title: "Add machine",
      description: "Register another PI WEB runtime reachable from this gateway",
      group: "Machine",
      run: (context) => context.addMachine(),
    },
    {
      id: "machine.refresh",
      title: "Refresh selected machine",
      description: "Check whether the selected PI WEB runtime is online",
      group: "Machine",
      run: (context) => context.refreshSelectedMachine(),
    },
    {
      id: "machine.open",
      title: "Open selected machine PI WEB",
      description: "Open the selected remote PI WEB directly in a new tab",
      group: "Machine",
      enabled: (context) => context.state.selectedMachine?.kind === "remote" && context.state.selectedMachine.baseUrl !== undefined,
      run: (context) => context.openSelectedMachine(),
    },
    {
      id: "machine.remove",
      title: "Remove selected machine",
      description: "Remove the selected remote machine from this gateway",
      group: "Machine",
      enabled: (context) => context.state.selectedMachine?.kind === "remote",
      run: (context) => context.removeSelectedMachine(),
    },
    {
      id: "project.add",
      title: "Add project",
      group: "Project",
      run: (context) => context.addProject(),
    },
    {
      id: "auth.login",
      title: "Configure provider authentication",
      description: "Run /login without tying authentication to a session",
      group: "General",
      run: (context) => context.configureAuth(),
    },
    {
      id: "auth.logout",
      title: "Remove provider authentication",
      description: "Run /logout for stored pi credentials",
      group: "General",
      run: (context) => context.logoutAuth(),
    },
    {
      id: "theme.select",
      title: "Select theme",
      description: "Choose the PI WEB color theme",
      group: "Preferences",
      run: (context) => { context.openThemePicker(); },
    },
    {
      id: "settings.open",
      title: "Open settings",
      description: "Manage PI WEB configuration and keyboard shortcuts",
      shortcut: "mod+,",
      group: "Preferences",
      run: (context) => { context.piWebUnstable?.openSettings?.(); },
    },
    {
      id: "app.reload-page",
      title: "Full page reload",
      description: "Reload the PI WEB browser page",
      group: "General",
      run: (context) => { context.reloadPage(); },
    },
    {
      id: "view.chat",
      title: "Go to chat",
      shortcut: "mod+1",
      group: "Navigation",
      run: (context) => { context.focusPrompt(); },
    },
    {
      id: "view.files",
      title: "Go to files",
      shortcut: "mod+2",
      group: "Navigation",
      enabled: hasWorkspace,
      run: (context) => { context.selectMainView("core:workspace.files"); },
    },
    {
      id: "view.terminal",
      // Third view, third number. This was mod+4 with nothing on mod+3, so the
      // numbers named no position and had to be memorised one at a time.
      title: "Go to terminal",
      shortcut: "mod+3",
      group: "Navigation",
      enabled: hasWorkspace,
      run: (context) => { context.selectMainView("core:workspace.terminal"); },
    },
    {
      id: "workspace.refresh-files",
      title: "Refresh files",
      shortcut: "mod+shift+f",
      group: "Workspace",
      enabled: hasWorkspace,
      run: (context) => context.refreshFiles(),
    },
    {
      id: "workspace.delete",
      title: "Remove workspace",
      description: "Run the owning provider's workspace removal operation",
      group: "Workspace",
      enabled: hasDeletableWorkspace,
      run: (context) => context.deleteWorkspace(),
    },
    {
      id: "session.start",
      title: "Start session",
      shortcut: "mod+enter",
      group: "Session",
      enabled: hasWorkspace,
      run: (context) => context.startSession(),
    },
    {
      id: "model.select",
      title: "Select model",
      description: "Choose the model for the selected session",
      group: "Session",
      enabled: hasSelectableSession,
      run: (context) => context.openModelPicker(),
    },
    {
      id: "thinking.select",
      title: "Select thinking level",
      description: "Choose the thinking level for the selected session",
      group: "Session",
      enabled: hasSelectableSession,
      run: (context) => context.openThinkingLevelPicker(),
    },
    {
      id: "session.archive",
      title: "Archive session",
      description: "Archive the selected session",
      group: "Session",
      enabled: hasArchivableSession,
      run: (context) => context.archiveSession(),
    },
    {
      id: "session.reload",
      title: "Reload session from disk",
      description: "Close and re-open the selected session from its session file. Use /reload in the prompt for Pi runtime resources.",
      group: "Session",
      enabled: hasReloadableSession,
      run: (context) => context.reloadSession(),
    },
    {
      id: "session.delete",
      title: "Delete new session",
      description: "Delete the selected transient new session",
      group: "Session",
      enabled: hasTransientNewSession,
      run: (context) => context.deleteCachedNewSession(),
    },
    {
      id: "session.stop",
      title: "Stop active work",
      shortcut: "mod+.",
      group: "Session",
      enabled: (context) => context.state.selectedSession !== undefined && isSessionActive(context.state.status, context.state.activity),
      run: (context) => context.stopActiveWork(),
    },
  ];
}

function hasWorkspace(context: { state: AppState }): boolean {
  return context.state.selectedWorkspace !== undefined;
}

function hasDeletableWorkspace(context: { state: AppState }): boolean {
  const workspace = context.state.selectedWorkspace;
  return canDeleteWorkspace(workspace) && !isWorkspaceDeletionPending(context.state, workspace);
}

function hasSelectableSession(context: { state: AppState }): boolean {
  const session = context.state.selectedSession;
  return session !== undefined && session.archived !== true;
}

function hasArchivableSession(context: { state: AppState }): boolean {
  return isArchivableSessionInfo(context.state.selectedSession, context.state.status);
}

function hasTransientNewSession(context: { state: AppState }): boolean {
  return isTransientNewSessionInfo(context.state.selectedSession, context.state.status);
}

function hasReloadableSession(context: { state: AppState }): boolean {
  if (!isArchivableSessionInfo(context.state.selectedSession, context.state.status)) return false;
  return !isSessionActive(context.state.status, context.state.activity);
}
