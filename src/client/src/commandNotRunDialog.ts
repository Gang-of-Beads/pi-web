import { html } from "lit";
import "./components/CommandNotRunCard";
import type { PluginDialog, PluginDialogHandle } from "./plugins/types";
import type { NewTerminalCommand, UntypedCommandOutcome } from "./plugins/machineTerminalSessions";

/**
 * One sentence per way the page's typing failed, naming the machine the shell is on: a dialog stays
 * open across a machine switch, so the reader must not take the command to another machine's shell
 * (review d3c7f62a, P1-1). None asserts the shell is still there: the page cannot see it.
 */
const UNTYPED_SENTENCE: Readonly<Record<UntypedCommandOutcome, (machineName: string) => string>> = {
  "open-timeout": (machineName) => `The terminal on ${machineName} did not open in time for this page to type the command; if the shell is still open, run it there.`,
  "stream-failed": (machineName) => `The stream to the terminal on ${machineName} failed before this page could type the command; if the shell is still open, run it there.`,
  closed: (machineName) => `The terminal on ${machineName} closed before this page could type the command; if the shell is still open, run it there.`,
};

export interface CommandNotRunPorts {
  readonly showDialog: (dialog: PluginDialog) => PluginDialogHandle;
  readonly copyText: (text: string) => Promise<boolean>;
  /** Moves to the shell's machine and shows the Terminal page on the shell, or on another when that shell is gone. */
  readonly openTerminal: () => void;
}

/**
 * Tell the reader that a command this page started a shell for was not typed, with the command to
 * copy and the way to the shell (owner, 2026-10-21). Escape, the backdrop and the close key only
 * close it; Open Terminal closes it and shows the shell.
 */
export function showCommandNotRun(ports: CommandNotRunPorts, outcome: UntypedCommandOutcome, input: NewTerminalCommand, machineName: string): PluginDialogHandle {
  const heading = `${input.title} did not run`;
  const handle = ports.showDialog({
    label: heading,
    presentation: "alert",
    content: html`<pi-command-not-run-card
      .heading=${heading}
      .sentence=${UNTYPED_SENTENCE[outcome](machineName)}
      .command=${input.command}
      .copyText=${ports.copyText}
      .onClose=${() => { handle.close(); }}
      .onOpenTerminal=${() => { handle.close(); ports.openTerminal(); }}
    ></pi-command-not-run-card>`,
  });
  return handle;
}
