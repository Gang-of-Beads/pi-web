import { vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { PluginRuntimeContext } from "./types";

export function createPluginRuntimeContext(statePatch: Partial<AppState> = {}) {
  const calls: string[] = [];
  const context: PluginRuntimeContext = {
    state: { ...initialAppState(), ...statePatch },
    prompt: {
      insertText: vi.fn(),
      getText: vi.fn(() => ""),
      getSelection: vi.fn(() => null),
    },
    piWebUnstable: {
      terminalCommandRuns: {
        runCommand: vi.fn(),
        listCommandRuns: vi.fn(),
        getCommandRun: vi.fn(),
        open: vi.fn((options?: { terminalId?: string | undefined }) => { calls.push(`terminal.open:${options?.terminalId ?? ""}`); }),
      },
      openSettings: vi.fn(() => { calls.push("openSettings"); }),
    },
    openActionPalette: vi.fn(() => { calls.push("openActionPalette"); }),
    focusPrompt: vi.fn(() => { calls.push("focusPrompt"); }),
    addProject: vi.fn(() => { calls.push("addProject"); }),
    addMachine: vi.fn(() => { calls.push("addMachine"); }),
    refreshSelectedMachine: vi.fn(() => { calls.push("refreshSelectedMachine"); }),
    removeSelectedMachine: vi.fn(() => { calls.push("removeSelectedMachine"); }),
    openSelectedMachine: vi.fn(() => { calls.push("openSelectedMachine"); }),
    configureAuth: vi.fn(() => { calls.push("configureAuth"); }),
    logoutAuth: vi.fn(() => { calls.push("logoutAuth"); }),
    openThemePicker: vi.fn(() => { calls.push("openThemePicker"); }),
    openModelPicker: vi.fn(() => { calls.push("openModelPicker"); }),
    openThinkingLevelPicker: vi.fn(() => { calls.push("openThinkingLevelPicker"); }),
    selectMainView: vi.fn((view: AppState["mainView"]) => { calls.push(`selectMainView:${view}`); }),
    selectWorkspaceTool: vi.fn((tool: AppState["workspaceTool"]) => { calls.push(`selectWorkspaceTool:${tool}`); }),
    openTerminal: vi.fn((options?: { terminalId?: string | undefined }) => { calls.push(`openTerminal:${options?.terminalId ?? ""}`); }),
    refreshFiles: vi.fn(() => { calls.push("refreshFiles"); }),
    refreshWorkspacePanels: vi.fn(() => { calls.push("refreshWorkspacePanels"); }),
    refreshAppData: vi.fn(() => { calls.push("refreshAppData"); }),
    reloadPage: vi.fn(() => { calls.push("reloadPage"); }),
    deleteWorkspace: vi.fn(() => { calls.push("deleteWorkspace"); }),
    startSession: vi.fn(() => { calls.push("startSession"); }),
    archiveSession: vi.fn(() => { calls.push("archiveSession"); }),
    reloadSession: vi.fn(() => { calls.push("reloadSession"); }),
    deleteCachedNewSession: vi.fn(() => { calls.push("deleteCachedNewSession"); }),
    stopActiveWork: vi.fn(() => { calls.push("stopActiveWork"); }),
  };
  return { context, calls };
}
