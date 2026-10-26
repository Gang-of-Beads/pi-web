/**
 * Guards for a value read without a type: a parsed body, a stored entry, a thrown error. The
 * browser, the web process and the daemon each kept private copies of these (the 2026-10-06
 * code audit counted 57 `isRecord` alone); this module is the one copy all three import.
 *
 * The shared files compiled into the published plugin-api package (activeAgentProfile,
 * machineStatus, piWebStatusParsing) keep their own copy: importing this module would add a private
 * helper to the package's exact declaration set and strip their module docstrings from it.
 */

/** A plain object: not null and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A property of a plain object, or undefined when the value is not one. */
export function getProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** A string property of a plain object, or undefined when absent or of another type. */
export function getString(value: unknown, key: string): string | undefined {
  const property = getProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

/** A boolean property of a plain object, or undefined when absent or of another type. */
export function getBoolean(value: unknown, key: string): boolean | undefined {
  const property = getProperty(value, key);
  return typeof property === "boolean" ? property : undefined;
}

/** A JSON value with every object's keys sorted, so two values that differ only in key order serialize the same. */
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

/** The message of a thrown value, or the value itself as text when it is not an Error. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
