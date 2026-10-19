import type { CommandResult, SlashCommand } from "../../../shared/apiTypes";
import type { PluginCommandRefusal, PluginSessionCommandNotice, PluginSessionCommandOutcome, PluginSessionCommandRequest } from "../../../shared/pluginApiTypes";

/**
 * Whether the host runs a plugin's command (design B3/S3 v2, 4.2). A browser plugin is trusted page
 * code, so this is the contract the host keeps and shows, not a sandbox: the page runs only the
 * extension commands its package declared, by their invocation name, in the session its rows were
 * read for. Built-ins, skills and prompt templates are refused: they replace the session or put
 * words in front of the model. A name two extensions share is listed as `name:1`, `name:2`, so the
 * declared name does not match and the call is refused rather than picking one.
 */
export type PluginCommandAdmission = "admit" | Exclude<PluginCommandRefusal, "not-stored" | "machine-refused">;

/** A session by the machine it is on. */
export interface SessionOnMachine {
  readonly machineId: string;
  readonly sessionId: string;
}

export interface PluginCommandFacts {
  readonly declared: readonly string[];
  /** The machine the page is about. */
  readonly pageMachineId: string;
  readonly request: PluginSessionCommandRequest;
  /** The session's commands, or "unknown" when they could not be read. */
  readonly commands: readonly SlashCommand[] | "unknown";
  /** The session on screen at call time; undefined when none is, or it is still starting. */
  readonly onScreen: SessionOnMachine | undefined;
}

export function pluginCommandAdmission(facts: PluginCommandFacts): PluginCommandAdmission {
  const { request, onScreen } = facts;
  if (onScreen === undefined) return "no-session";
  if (onScreen.machineId !== facts.pageMachineId || onScreen.sessionId !== request.sessionId) return "session-changed";
  if (!facts.declared.includes(request.name)) return "not-declared";
  if (/[\r\n]/u.test(request.args ?? "")) return "args-not-one-line";
  if (facts.commands === "unknown") return "commands-unknown";
  return facts.commands.some((command) => command.source === "extension" && command.name === request.name) ? "admit" : "not-extension-command";
}

const ADMISSION_REFUSAL_WORDS: Readonly<Record<Exclude<PluginCommandAdmission, "admit">, (name: string) => string>> = {
  "not-declared": (name) => `This page may not run /${name}.`,
  "not-extension-command": (name) => `This session has no extension command /${name}.`,
  "commands-unknown": () => "This session's commands could not be read; try again.",
  "session-changed": () => "The session on screen changed.",
  "no-session": () => "No session is open.",
  "args-not-one-line": () => "A command's words must stay on one line.",
};

export function admissionRefusal(admission: Exclude<PluginCommandAdmission, "admit">, name: string): PluginSessionCommandOutcome {
  return { kind: "refused", reason: admission, words: ADMISSION_REFUSAL_WORDS[admission](name) };
}

export const NOT_STORED_REFUSAL: PluginSessionCommandOutcome = { kind: "refused", reason: "not-stored", words: "This browser could not store the command, so it was not sent." };

/** The text a plugin's command is sent as: the host builds it, never the plugin. */
export function pluginCommandText(request: Pick<PluginSessionCommandRequest, "name" | "args">): string {
  const words = request.args?.trim() ?? "";
  return words === "" ? `/${request.name}` : `/${request.name} ${words}`;
}

const ANSWER_WAIT_MS = 10_000;

/**
 * The plugins' commands this page sent, by operation id, until each has its outcome. The outbox
 * runs them like any typed command; the session controller reports here what the machine said and
 * when the handler returned (`command.settled`, heard on the stream of the session on screen). A
 * command the machine took resolves `waiting` after ten seconds without its handler's answer; the
 * promise of one the machine has not answered stays pending while the outbox keeps sending.
 * Nothing here survives a reload: the plugin's own read of its state is then the truth.
 */
export class PluginCommandWaiters {
  private readonly waiting = new Map<string, { readonly resolve: (outcome: PluginSessionCommandOutcome) => void; timer: ReturnType<typeof setTimeout> | undefined }>();

  constructor(private readonly answerWaitMs = ANSWER_WAIT_MS) {}

  wait(clientMessageId: string): Promise<PluginSessionCommandOutcome> {
    return new Promise((resolve) => { this.waiting.set(clientMessageId, { resolve, timer: undefined }); });
  }

  /** The machine refused the operation for good. */
  refused(clientMessageId: string, words: string): void {
    this.finish(clientMessageId, { kind: "refused", reason: "machine-refused", words });
  }

  /** The machine's answer to the command it took. */
  answered(clientMessageId: string, result: CommandResult): void {
    if (result.type === "unsupported") {
      this.refused(clientMessageId, result.message);
      return;
    }
    const waiter = this.waiting.get(clientMessageId);
    if (waiter === undefined || waiter.timer !== undefined) return;
    waiter.timer = setTimeout(() => { this.finish(clientMessageId, { kind: "waiting" }); }, this.answerWaitMs);
  }

  /** The command's handler returned, having shown the reader these notices. */
  settled(clientMessageId: string, notices: readonly PluginSessionCommandNotice[]): void {
    this.finish(clientMessageId, { kind: "ran", notices });
  }

  /** The machine took the command and its answer could not be read. */
  lost(clientMessageId: string, words: string): void {
    this.finish(clientMessageId, { kind: "unknown", words });
  }

  private finish(clientMessageId: string, outcome: PluginSessionCommandOutcome): void {
    const waiter = this.waiting.get(clientMessageId);
    if (waiter === undefined) return;
    this.waiting.delete(clientMessageId);
    clearTimeout(waiter.timer);
    waiter.resolve(outcome);
  }
}
