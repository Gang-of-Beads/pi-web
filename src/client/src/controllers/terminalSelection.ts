import { browserSessionStorage, parseStoredString, PersistentValueMap, type KeyValueStorage } from "./sessionStorageMemory";

export interface TerminalSelectionMemory {
  latestTerminalId(cwd: string): string | undefined;
  rememberTerminal(cwd: string, terminalId: string): void;
  forgetWorkspace(cwd: string): void;
  forgetTerminal(terminalId: string): void;
}

export class InMemoryTerminalSelectionMemory implements TerminalSelectionMemory {
  private readonly terminalIdsByCwd = new Map<string, string>();

  latestTerminalId(cwd: string): string | undefined {
    return this.terminalIdsByCwd.get(cwd);
  }

  rememberTerminal(cwd: string, terminalId: string): void {
    this.terminalIdsByCwd.set(cwd, terminalId);
  }

  forgetWorkspace(cwd: string): void {
    this.terminalIdsByCwd.delete(cwd);
  }

  forgetTerminal(terminalId: string): void {
    for (const [cwd, rememberedTerminalId] of this.terminalIdsByCwd.entries()) {
      if (rememberedTerminalId === terminalId) this.terminalIdsByCwd.delete(cwd);
    }
  }
}

const terminalSelectionStorageKey = "pi-web:terminal-selection:v1";

export class SessionStorageTerminalSelectionMemory implements TerminalSelectionMemory {
  private readonly terminalIdsByCwd: PersistentValueMap<string>;

  constructor(storage: KeyValueStorage | undefined = browserSessionStorage()) {
    this.terminalIdsByCwd = new PersistentValueMap(terminalSelectionStorageKey, parseStoredString, storage);
  }

  latestTerminalId(cwd: string): string | undefined {
    return this.terminalIdsByCwd.get(cwd);
  }

  rememberTerminal(cwd: string, terminalId: string): void {
    this.terminalIdsByCwd.set(cwd, terminalId);
  }

  forgetWorkspace(cwd: string): void {
    this.terminalIdsByCwd.delete(cwd);
  }

  forgetTerminal(terminalId: string): void {
    for (const [cwd, rememberedTerminalId] of this.terminalIdsByCwd.entries()) {
      if (rememberedTerminalId === terminalId) this.terminalIdsByCwd.delete(cwd);
    }
  }
}
