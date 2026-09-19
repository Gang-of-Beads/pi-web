/**
 * Finding a setting by name.
 *
 * The list is short enough to read but not short enough to scan for a word you
 * half remember, and plugins add their own sections, so the list grows with
 * what is installed. The match is forgiving on purpose: a subsequence match
 * finds "sess daemon" and "kbd" is not expected to find "Keyboard" - typos
 * that drop letters are common, typos that invent them are not.
 */

export interface SettingsEntry<Id extends string = string> {
  id: Id;
  label: string;
  detail: string;
}

export interface SettingsMatch<Id extends string = string> extends SettingsEntry<Id> {
  score: number;
}

function subsequenceScore(haystack: string, needle: string): number | undefined {
  if (needle === "") return 0;
  let index = 0;
  let score = 0;
  let previous = -1;
  for (const character of needle) {
    const found = haystack.indexOf(character, index);
    if (found === -1) return undefined;
    // Letters that stayed together describe the word better than letters
    // scattered across it.
    score += previous === found - 1 ? 0 : 1;
    previous = found;
    index = found + 1;
  }
  return score;
}

export function searchSettings<Id extends string>(entries: readonly SettingsEntry<Id>[], query: string): SettingsMatch<Id>[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return entries.map((entry) => ({ ...entry, score: 0 }));
  const matches: SettingsMatch<Id>[] = [];
  for (const entry of entries) {
    const label = subsequenceScore(entry.label.toLowerCase(), needle);
    const detail = label === undefined ? subsequenceScore(`${entry.label} ${entry.detail}`.toLowerCase(), needle) : undefined;
    const score = label ?? (detail === undefined ? undefined : detail + 100);
    if (score !== undefined) matches.push({ ...entry, score });
  }
  return matches.sort((left, right) => left.score - right.score || left.label.localeCompare(right.label));
}
