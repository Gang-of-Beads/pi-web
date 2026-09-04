/**
 * The goals this plugin has read, for one workspace at a time.
 *
 * Absence is three states here, not two: a read that has not happened, a read
 * that finished and found none, and a read that failed. A panel that showed
 * the last two the same way is how an unreachable daemon looked like a
 * workspace with no goals.
 *
 * Every slot carries the workspace it was read for. A value fetched for one
 * workspace must never render under another, which is the rule that stopped
 * this project rendering another project's goal with a live Abandon button on
 * it.
 */

export type GoalsLoadState = "unloaded" | "loading" | "loaded" | "failed";

export interface GoalsLoad<T> {
  readonly state: GoalsLoadState;
  readonly key: string | undefined;
  readonly data: readonly T[];
  readonly error?: string;
}

export function unloadedGoals<T>(): GoalsLoad<T> {
  return { state: "unloaded", key: undefined, data: [] };
}

export function loadingGoals<T>(key: string, previous: GoalsLoad<T>): GoalsLoad<T> {
  const keep = previous.key === key ? previous.data : [];
  return { state: "loading", key, data: keep };
}

export function loadedGoals<T>(key: string, data: readonly T[]): GoalsLoad<T> {
  return { state: "loaded", key, data };
}

export function failedGoals<T>(key: string, error: string, previous: GoalsLoad<T>): GoalsLoad<T> {
  const keep = previous.key === key ? previous.data : [];
  return { state: "failed", key, data: keep, error };
}

/**
 * What a slot may render for the workspace being shown. A slot read for a
 * different workspace answers as unloaded rather than lending its rows.
 */
export function goalsForKey<T>(load: GoalsLoad<T>, key: string | undefined): GoalsLoad<T> {
  if (key === undefined || load.key !== key) return unloadedGoals<T>();
  return load;
}
