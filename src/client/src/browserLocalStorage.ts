/**
 * The page's localStorage, or undefined where there is none or where touching it throws (Safari
 * private mode, storage disabled by policy). Nine modules each kept a copy of this probe, and one
 * of them (project pins) had lost the guard, so a page that could not use storage failed there.
 */
export function browserLocalStorage(): Storage | undefined {
  try {
    if (typeof window !== "undefined") return window.localStorage;
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
