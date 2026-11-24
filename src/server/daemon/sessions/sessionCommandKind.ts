import { builtinCommandOf } from "../../../shared/builtinSlashCommands.js";

interface CommandResources {
  readonly extensionRunner: { getRegisteredCommands(): readonly { invocationName: string }[] };
  readonly promptTemplates: readonly { name: string }[];
  readonly resourceLoader: { getSkills(): { skills: readonly { name: string }[] } };
}

export type SessionCommandKind = "builtin" | "extension" | "resource" | "message";

/** Pi reads extension and skill names to the first literal space, but templates to whitespace. */
export function runtimeCommandOf(session: CommandResources, text: string): { kind: "extension" | "resource"; name: string } | undefined {
  if (!text.startsWith("/")) return undefined;
  const name = text.slice(1).split(" ", 1)[0] ?? "";
  if (session.extensionRunner.getRegisteredCommands().some((command) => command.invocationName === name)) return { kind: "extension", name };
  if (name.startsWith("skill:") && session.resourceLoader.getSkills().skills.some((skill) => `skill:${skill.name}` === name)) return { kind: "resource", name };
  const templateName = text.slice(1).split(/\s/u, 1)[0] ?? "";
  return session.promptTemplates.some((template) => template.name === templateName) ? { kind: "resource", name: templateName } : undefined;
}

export type QueuedCommandDispatch = "input" | "extension" | "refused";

/**
 * Both SDK handoff paths preserve explicit command-only boundaries; ordinary user input stays native.
 * A queued command that names nothing the session runs is refused only when it had to be an
 * extension command (a plugin's or the tree button's). Typed text an older page queued as a command
 * is what this page now sends as a message, so it is handed on as one instead of being dropped at a
 * restart across the upgrade.
 */
export function queuedCommandDispatch(session: CommandResources, entry: { readonly text: string; readonly command?: { readonly extensionOnly?: true } }): QueuedCommandDispatch {
  const runtime = runtimeCommandOf(session, entry.text);
  if (entry.command?.extensionOnly === true && runtime?.kind !== "extension") return "refused";
  return runtime?.kind === "extension" ? "extension" : "input";
}

export function sessionCommandKind(session: CommandResources, text: string): SessionCommandKind {
  return builtinCommandOf(text) === undefined ? runtimeCommandOf(session, text)?.kind ?? "message" : "builtin";
}
