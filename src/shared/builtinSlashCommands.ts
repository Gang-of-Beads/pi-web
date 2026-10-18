/**
 * pi's built-in slash commands and how PI WEB handles each one.
 *
 * The SDK keeps its list in `BUILTIN_SLASH_COMMANDS` (pi-coding-agent `dist/core/slash-commands.js`) and does not
 * export it, so PI WEB keeps this copy of pi 1.3.0's 24 commands, with pi's descriptions and argument hints. Compare
 * it with that file on every SDK upgrade: a command pi adds must get a row here, and the Record makes a row without a
 * handling a type error.
 *
 * `page`: the browser page handles it from the composer, busy or idle, and never sends it. `daemon`: the session
 * daemon runs it. `unavailable`: PI WEB does not offer it; typed, the daemon answers that it is not available.
 */
export type PageCommandName = "settings" | "model" | "thinking" | "scoped-models" | "copy" | "hotkeys" | "login" | "logout" | "resume";
export type DaemonCommandName = "tree" | "export" | "name" | "session" | "changelog" | "fork" | "clone" | "trust" | "new" | "compact" | "reload";
export type UnavailableCommandName = "import" | "share" | "bug" | "quit";
export type BuiltinCommandName = PageCommandName | DaemonCommandName | UnavailableCommandName;

export type BuiltinCommandHandling = "page" | "daemon" | "unavailable";

type HandlingOf<Name extends BuiltinCommandName> = Name extends PageCommandName ? "page" : Name extends DaemonCommandName ? "daemon" : "unavailable";

export interface BuiltinCommand<Handling extends BuiltinCommandHandling = BuiltinCommandHandling> {
  readonly description: string;
  readonly argumentHint?: string;
  readonly handling: Handling;
}

export const BUILTIN_COMMANDS: { readonly [Name in BuiltinCommandName]: BuiltinCommand<HandlingOf<Name>> } = {
  settings: { description: "Open settings menu", handling: "page" },
  model: { description: "Select model (opens selector UI)", argumentHint: "<provider/model>", handling: "page" },
  tree: { description: "Navigate session tree (switch branches)", handling: "daemon" },
  thinking: { description: "Set thinking level", argumentHint: "<level>", handling: "page" },
  "scoped-models": { description: "Enable/disable models for Ctrl+P cycling", handling: "page" },
  export: { description: "Export session (HTML default, or specify path: .html/.jsonl)", handling: "daemon" },
  import: { description: "Import and resume a session from a JSONL file", handling: "unavailable" },
  share: { description: "Share session via a Radius artifact or a GitHub gist", handling: "unavailable" },
  bug: { description: "Report a bug to the Pi developers", argumentHint: "<description>", handling: "unavailable" },
  copy: { description: "Copy last agent message to clipboard", handling: "page" },
  name: { description: "Set session display name", handling: "daemon" },
  session: { description: "Show session info and stats", handling: "daemon" },
  changelog: { description: "Show changelog entries", handling: "daemon" },
  hotkeys: { description: "Show all keyboard shortcuts", handling: "page" },
  fork: { description: "Create a new fork from a previous user message", handling: "daemon" },
  clone: { description: "Duplicate the current session at the current position", handling: "daemon" },
  trust: { description: "Save project trust decision for future sessions", handling: "daemon" },
  login: { description: "Configure provider authentication", argumentHint: "<provider>", handling: "page" },
  logout: { description: "Remove provider authentication", handling: "page" },
  new: { description: "Start a new session", handling: "daemon" },
  compact: { description: "Manually compact the session context", handling: "daemon" },
  resume: { description: "Resume a different session", handling: "page" },
  reload: { description: "Reload keybindings, extensions, skills, prompts, themes, and context files", handling: "daemon" },
  quit: { description: "Quit pi", handling: "unavailable" },
};

/** A typed command split as pi reads it: the word after the slash, and the rest. */
export function commandParts(text: string): { name: string; rest: string } {
  const [name = "", ...args] = text.trim().replace(/^\//u, "").split(/\s+/u);
  return { name, rest: args.join(" ").trim() };
}

export function isBuiltinCommandName(name: string): name is BuiltinCommandName {
  return Object.hasOwn(BUILTIN_COMMANDS, name);
}

export function isPageCommandName(name: string): name is PageCommandName {
  return isBuiltinCommandName(name) && BUILTIN_COMMANDS[name].handling === "page";
}

/**
 * Which page commands read words after their name. pi matches the others exactly and sends
 * `/resume where we left off` on as text, so the page does not run them with words after the name.
 */
const PAGE_COMMAND_TAKES_ARGUMENT: Readonly<Record<PageCommandName, boolean>> = {
  settings: false,
  model: true,
  thinking: true,
  "scoped-models": false,
  copy: false,
  hotkeys: false,
  login: true,
  logout: true,
  resume: false,
};

export function pageCommandRefusesArgument(name: PageCommandName, rest: string): boolean {
  return rest !== "" && !PAGE_COMMAND_TAKES_ARGUMENT[name];
}

/** The page command a composer's text is, with what follows its name; undefined for any other text, and for words after a command that takes none. */
export function pageCommandOf(text: string): { name: PageCommandName; argument: string } | undefined {
  if (!text.trim().startsWith("/")) return undefined;
  const { name, rest } = commandParts(text);
  return isPageCommandName(name) && !pageCommandRefusesArgument(name, rest) ? { name, argument: rest } : undefined;
}

export function isDaemonCommandName(name: string): name is DaemonCommandName {
  return isBuiltinCommandName(name) && BUILTIN_COMMANDS[name].handling === "daemon";
}
