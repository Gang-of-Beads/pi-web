const SESSION_COMMAND_NAME = /^[a-z0-9][a-z0-9:_-]*$/u;
const MAX_SESSION_COMMANDS = 16;

/**
 * A package's `piWeb.plugins[].sessionCommands`: at most 16 distinct extension command names
 * without the slash. Checked where the package is read and again where the browser reads the
 * manifest, so a name that could not be a command never reaches the page.
 */
export function isSessionCommandList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_SESSION_COMMANDS) return false;
  const names: unknown[] = value;
  return names.every((name) => typeof name === "string" && SESSION_COMMAND_NAME.test(name)) && new Set(names).size === names.length;
}
