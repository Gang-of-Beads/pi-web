/**
 * Guards for a value read without a type: a parsed body, a stored entry, a thrown error. The
 * browser, the web process and the daemon each kept private copies of these (the 2026-10-06
 * ponytail audit counted 57 `isRecord` alone); this module is the one copy all three import.
 */

/** A plain object: not null and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The message of a thrown value, or the value itself as text when it is not an Error. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
