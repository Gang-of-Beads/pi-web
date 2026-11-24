/**
 * pi's built-in slash commands and how PI WEB handles each one.
 *
 * The SDK keeps its list in `BUILTIN_SLASH_COMMANDS` (pi-coding-agent `dist/core/slash-commands.js`) and does not
 * export it, so PI WEB keeps this copy of pi 1.6.0's 24 menu commands, with pi's descriptions and argument
 * hints, plus the three hidden commands pi's terminal matches, whose descriptions PI WEB wrote. Compare
 * it with that file on every SDK upgrade: a command pi adds must get a row here, and the Record makes a row without a
 * handling a type error.
 *
 * `page`: the browser page handles it from the composer, busy or idle, and never sends it. `daemon`: the session
 * daemon runs it. `unavailable`: PI WEB does not offer it; typed, the daemon answers that it is not available.
 *
 * `takesWords` is how pi's interactive mode matches the command on the trimmed text: only the bare name, or also
 * the name and words after a space (`text === "/model" || text.startsWith("/model ")`). Compare it with
 * `interactive-mode.js`'s onSubmit on every SDK upgrade, as the list itself.
 */
export type PageCommandName = "settings" | "model" | "thinking" | "scoped-models" | "copy" | "hotkeys" | "login" | "logout" | "resume";
export type DaemonCommandName = "tree" | "export" | "name" | "session" | "changelog" | "fork" | "clone" | "trust" | "new" | "compact" | "reload";
export type UnavailableCommandName = "import" | "share" | "bug" | "quit" | "debug" | "arminsayshi" | "dementedelves";
export type BuiltinCommandName = PageCommandName | DaemonCommandName | UnavailableCommandName;

export type BuiltinCommandHandling = "page" | "daemon" | "unavailable";

type HandlingOf<Name extends BuiltinCommandName> = Name extends PageCommandName ? "page" : Name extends DaemonCommandName ? "daemon" : "unavailable";

export interface BuiltinCommand<Handling extends BuiltinCommandHandling = BuiltinCommandHandling> {
  readonly description: string;
  readonly argumentHint?: string;
  readonly handling: Handling;
  readonly takesWords: boolean;
}

export const BUILTIN_COMMANDS: { readonly [Name in BuiltinCommandName]: BuiltinCommand<HandlingOf<Name>> } = {
  settings: { description: "Open settings menu", takesWords: false, handling: "page" },
  model: { description: "Select model (opens selector UI)", argumentHint: "<provider/model>", takesWords: true, handling: "page" },
  tree: { description: "Navigate session tree (switch branches)", takesWords: false, handling: "daemon" },
  thinking: { description: "Set thinking level", argumentHint: "<level>", takesWords: true, handling: "page" },
  "scoped-models": { description: "Enable/disable models for Ctrl+P cycling", takesWords: false, handling: "page" },
  export: { description: "Export session (HTML default, or specify path: .html/.jsonl)", takesWords: true, handling: "daemon" },
  import: { description: "Import a JSONL session, preserving its ID and working directory", takesWords: true, handling: "unavailable" },
  share: { description: "Share session via a Radius artifact or a GitHub gist", takesWords: false, handling: "unavailable" },
  bug: { description: "Report a bug to the Pi developers", argumentHint: "<description>", takesWords: true, handling: "unavailable" },
  copy: { description: "Copy last agent message to clipboard", takesWords: false, handling: "page" },
  name: { description: "Set session display name", takesWords: true, handling: "daemon" },
  session: { description: "Show session info and stats", takesWords: false, handling: "daemon" },
  changelog: { description: "Show changelog entries", takesWords: false, handling: "daemon" },
  hotkeys: { description: "Show all keyboard shortcuts", takesWords: false, handling: "page" },
  fork: { description: "Create a new fork from a previous user message", takesWords: false, handling: "daemon" },
  clone: { description: "Duplicate the current session at the current position", takesWords: false, handling: "daemon" },
  trust: { description: "Save project trust decision for future sessions", takesWords: false, handling: "daemon" },
  login: { description: "Configure provider authentication", argumentHint: "<provider>", takesWords: true, handling: "page" },
  logout: { description: "Remove provider authentication", takesWords: false, handling: "page" },
  new: { description: "Start a new session", takesWords: false, handling: "daemon" },
  compact: { description: "Manually compact the session context", takesWords: true, handling: "daemon" },
  resume: { description: "Resume another session", takesWords: false, handling: "page" },
  reload: { description: "Reload keybindings, extensions, skills, prompts, themes, and context files", takesWords: false, handling: "daemon" },
  quit: { description: "Quit pi", takesWords: false, handling: "unavailable" },
  debug: { description: "Open Pi's terminal debug view", takesWords: false, handling: "unavailable" },
  arminsayshi: { description: "Open Pi's terminal greeting", takesWords: false, handling: "unavailable" },
  dementedelves: { description: "Open Pi's terminal display", takesWords: false, handling: "unavailable" },
};

export function isBuiltinCommandName(name: string): name is BuiltinCommandName {
  return Object.hasOwn(BUILTIN_COMMANDS, name);
}

export function isUnavailableBuiltinName(name: string): boolean {
  return isBuiltinCommandName(name) && BUILTIN_COMMANDS[name].handling === "unavailable";
}

export function isPageCommandName(name: string): name is PageCommandName {
  return isBuiltinCommandName(name) && BUILTIN_COMMANDS[name].handling === "page";
}

/**
 * The built-in a composer's text is, matched as pi 1.6.0's interactive mode matches it: on the trimmed text,
 * the bare name, or for a command that takes words the name and words after a space. Anything else - a path,
 * an unknown name, a built-in followed by words it does not take - is no built-in: pi hands it to
 * `session.prompt`, which runs an extension command, expands a skill or a template, or sends it to the model as
 * a message, and so does PI WEB (owner, 2026-11-16: "/home/example/notes.txt" answered "Unknown command").
 */
export function builtinCommandOf(text: string): { name: BuiltinCommandName; rest: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const space = trimmed.indexOf(" ");
  const name = space === -1 ? trimmed.slice(1) : trimmed.slice(1, space);
  if (!isBuiltinCommandName(name)) return undefined;
  if (space === -1) return { name, rest: "" };
  return BUILTIN_COMMANDS[name].takesWords ? { name, rest: trimmed.slice(space + 1).trim() } : undefined;
}

/** The page command a composer's text is, with what follows its name; undefined for any other text. */
export function pageCommandOf(text: string): { name: PageCommandName; argument: string } | undefined {
  const command = builtinCommandOf(text);
  return command !== undefined && isPageCommandName(command.name) ? { name: command.name, argument: command.rest } : undefined;
}

export function isDaemonCommandName(name: string): name is DaemonCommandName {
  return isBuiltinCommandName(name) && BUILTIN_COMMANDS[name].handling === "daemon";
}
