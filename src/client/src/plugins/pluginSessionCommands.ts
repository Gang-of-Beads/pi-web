import type { CommandResult, SlashCommand } from "../../../shared/apiTypes";
import { isBuiltinCommandName } from "../../../shared/builtinSlashCommands";
import type { PluginCommandRefusal, PluginSessionCommandNotice, PluginSessionCommandOutcome, PluginSessionCommandRequest } from "../../../shared/pluginApiTypes";

/**
 * Whether the host runs a plugin's command (design B3/S3 v2, 4.2). A browser plugin is trusted page
 * code, so this is the contract the host keeps and shows, not a sandbox: the page runs only the
 * extension commands its package declared, by their invocation name, in the session its rows were
 * read for. Built-ins, skills and prompt templates are refused: they replace the session or put
 * words in front of the model. A built-in is refused by its name even where the session also lists
 * an extension command of that name: the machine runs the built-in first, so the extension's
 * handler would never run. A name two extensions share is listed as `name:1`, `name:2`, so the
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
  if (isBuiltinCommandName(request.name)) return "not-extension-command";
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

const WITHDRAWN_WORDS = "The queue was cleared before the command ran.";

interface CommandWaiter {
  readonly resolve: (outcome: PluginSessionCommandOutcome) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * The plugins' commands this page sent, by operation id, until each has its outcome. The outbox
 * runs them like any typed command; the session controller reports here what the machine said and
 * when the handler returned (`command.settled`, heard on the stream of the session on screen). A
 * command the machine took resolves `waiting` after ten seconds without its handler's answer; the
 * promise of one still in this browser's outbox stays pending while the outbox keeps sending.
 *
 * Every tab of the profile sends every outbox, and the tab whose send settles first is the only one
 * that hears the machine's answer. So the wait also starts when the command is sent, and once the
 * command has left this browser's outbox without this page hearing the answer, it resolves
 * `waiting` too: every promise resolves once its command has left this browser's outbox.
 *
 * The ids are kept for the page's life, after the promise resolved: the machine may hold the command
 * in its inbox for a while (a compaction, a settle), and it is the page's, not the reader's, so it
 * is neither listed as the reader's queued message nor returned to the reader's composer. Nothing here survives a reload: the plugin's own read of its state is then the truth.
 */
export class PluginCommandWaiters {
  private readonly waiting = new Map<string, CommandWaiter>();
  private readonly sent = new Set<string>();

  constructor(private readonly answerWaitMs = ANSWER_WAIT_MS) {}

  /** `inOutbox`: whether the command is still in this browser's outbox, unanswered. */
  wait(clientMessageId: string, inOutbox: () => boolean): Promise<PluginSessionCommandOutcome> {
    this.sent.add(clientMessageId);
    return new Promise((resolve) => {
      const waiter: CommandWaiter = { resolve, timer: undefined };
      const check = (): void => {
        if (!inOutbox()) {
          this.finish(clientMessageId, { kind: "waiting" });
          return;
        }
        waiter.timer = setTimeout(check, this.answerWaitMs);
      };
      waiter.timer = setTimeout(check, this.answerWaitMs);
      this.waiting.set(clientMessageId, waiter);
    });
  }

  /** Whether this page sent the command for a plugin. */
  sentForPlugin(clientMessageId: string | undefined): boolean {
    return clientMessageId !== undefined && this.sent.has(clientMessageId);
  }

  /** This page heard the machine accept the command: it reads the answer itself, and the wait counts from that answer. */
  taken(clientMessageId: string): void {
    const waiter = this.waiting.get(clientMessageId);
    if (waiter === undefined) return;
    clearTimeout(waiter.timer);
    waiter.timer = undefined;
  }

  /** The machine refused the operation for good. */
  refused(clientMessageId: string, words: string): void {
    this.finish(clientMessageId, { kind: "refused", reason: "machine-refused", words });
  }

  /**
   * Stop or Clear queue took the command off the machine's queue before it ran. The machine said so
   * (`prompt.withdrawn` for the command's id), so it is a refusal: the command did not run.
   */
  withdrawn(clientMessageId: string): void {
    this.refused(clientMessageId, WITHDRAWN_WORDS);
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
