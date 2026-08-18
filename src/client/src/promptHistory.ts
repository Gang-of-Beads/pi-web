const PROMPT_HISTORY_LIMIT = 50;
const PROMPT_HISTORY_PREFIX = "pi-web:prompt-history:";

export function promptHistoryKey(sessionKey: string): string {
  return `${PROMPT_HISTORY_PREFIX}${sessionKey}`;
}

export function loadPromptHistory(sessionKey: string): string[] {
  try {
    const raw = localStorage.getItem(promptHistoryKey(sessionKey));
    if (raw === null || raw === "") return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
  } catch {
    return [];
  }
}

export function savePromptHistory(sessionKey: string, values: readonly string[]): void {
  try {
    localStorage.setItem(promptHistoryKey(sessionKey), JSON.stringify(values.slice(0, PROMPT_HISTORY_LIMIT)));
  } catch {
    // Best-effort local convenience only.
  }
}

export function rememberPromptHistory(sessionKey: string, prompt: string): string[] {
  const normalized = prompt.trim();
  if (normalized === "") return loadPromptHistory(sessionKey);
  const current = loadPromptHistory(sessionKey).filter((entry) => entry !== normalized);
  const next = [normalized, ...current].slice(0, PROMPT_HISTORY_LIMIT);
  savePromptHistory(sessionKey, next);
  return next;
}

export function searchPromptHistory(sessionKey: string, query: string): string[] {
  const history = loadPromptHistory(sessionKey);
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return history;
  const tokens = normalized.split(/\s+/u).filter(Boolean);
  return history.filter((entry) => {
    const haystack = entry.toLowerCase();
    return tokens.every((token) => haystack.includes(token) || isSubsequence(token, haystack));
  });
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of needle) {
    index = haystack.indexOf(character, index);
    if (index === -1) return false;
    index += character.length;
  }
  return true;
}

/**
 * Which way through history a key moves.
 *
 * Named rather than passed as +1/-1 because the two are easy to swap and the
 * result still looks plausible: ArrowUp reached the most recent entry and then
 * appeared to stop, while ArrowDown walked backwards through time. Every shell,
 * and pi's own terminal UI, treat Up as "further back".
 */
export type HistoryDirection = "older" | "newer";

/** Index 0 is the most recent entry, so going older means counting up. */
export function historyIndexStep(direction: HistoryDirection): 1 | -1 {
  return direction === "older" ? 1 : -1;
}
