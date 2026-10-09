import type { AutocompleteProviderFactory } from "@earendil-works/pi-coding-agent";
import type { ExtensionCompletionItem, ExtensionCompletionSuggestions, ExtensionCompletionApplied } from "../../../shared/apiTypes.js";

type AutocompleteProvider = ReturnType<AutocompleteProviderFactory>;

export const COMPLETION_ITEMS_MAX = 50;
export const COMPLETION_FIELD_MAX = 200;
const COMPLETION_ANSWER_MS = 2_000;
const NO_SUGGESTIONS: ExtensionCompletionSuggestions = { prefix: "", items: [] };

/**
 * pi's `ctx.ui.addAutocompleteProvider` (pi-insertion-points.md slice 6). pi stacks each factory
 * over the provider so far, the last added outermost, starting from its built-in provider. PI WEB
 * draws its built-in completions (commands, files, models) in the browser, so the base here
 * suggests nothing, and applies an item as pi's base does a plain token: the prefix before the
 * cursor becomes the item's value. A composer whose ask gets no items shows its own completions,
 * as pi's editor shows its built-in provider's when the extensions' answer nothing new.
 *
 * Every call into the stack is extension code: a factory that throws or answers no provider is
 * skipped, a suggestion that throws, answers late (COMPLETION_ANSWER_MS) or answers no items is no
 * suggestion, an apply that throws or answers no lines and cursor falls back to the base. A newer ask
 * aborts the older one's signal, as pi's editor does while the reader types.
 */
export class ExtensionCompletionStack {
  private provider: AutocompleteProvider | undefined;
  private asking: AbortController | undefined;

  add(factory: unknown): void {
    if (typeof factory !== "function") return;
    try {
      const next: unknown = Reflect.apply(factory, undefined, [this.provider ?? BASE_PROVIDER]);
      if (isProvider(next)) this.provider = next;
    } catch (error) {
      console.warn("An extension autocomplete provider could not be built and is not used", error);
    }
  }

  clear(): void {
    this.asking?.abort();
    this.asking = undefined;
    this.provider = undefined;
  }

  /** The stack's trigger characters as pi's editor takes them (one character, not `/`, not blank); undefined without a stack. */
  triggerCharacters(): string[] | undefined {
    if (this.provider === undefined) return undefined;
    const declared: unknown = this.provider.triggerCharacters;
    const characters = Array.isArray(declared) ? declared.filter((character): character is string => typeof character === "string") : [];
    return [...new Set(characters.filter((character) => character.length === 1 && character !== "/" && character.trim() !== ""))];
  }

  async suggest(text: string, cursor: number, force: boolean): Promise<ExtensionCompletionSuggestions> {
    const provider = this.provider;
    if (provider === undefined) return NO_SUGGESTIONS;
    this.asking?.abort();
    const asking = new AbortController();
    this.asking = asking;
    const { lines, cursorLine, cursorCol } = linesAt(text, cursor);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        asking.abort();
        resolve(undefined);
      }, COMPLETION_ANSWER_MS);
    });
    try {
      const answer: unknown = await Promise.race([provider.getSuggestions(lines, cursorLine, cursorCol, { signal: asking.signal, force }), late]);
      return asking.signal.aborted ? NO_SUGGESTIONS : boundedSuggestions(answer);
    } catch (error) {
      if (!asking.signal.aborted) console.warn("An extension autocomplete provider failed to suggest", error);
      return NO_SUGGESTIONS;
    } finally {
      clearTimeout(timer);
      if (this.asking === asking) this.asking = undefined;
    }
  }

  apply(text: string, cursor: number, item: ExtensionCompletionItem, prefix: string): ExtensionCompletionApplied {
    const { lines, cursorLine, cursorCol } = linesAt(text, cursor);
    try {
      return appliedText((this.provider ?? BASE_PROVIDER).applyCompletion(lines, cursorLine, cursorCol, item, prefix));
    } catch (error) {
      console.warn("An extension autocomplete provider failed to apply a completion", error);
      return appliedText(BASE_PROVIDER.applyCompletion(lines, cursorLine, cursorCol, item, prefix));
    }
  }
}

const BASE_PROVIDER: AutocompleteProvider = {
  getSuggestions: () => Promise.resolve(null),
  applyCompletion: (lines, cursorLine, cursorCol, item, prefix) => {
    const line = lines[cursorLine] ?? "";
    const start = Math.max(0, cursorCol - prefix.length);
    const next = [...lines];
    next[cursorLine] = `${line.slice(0, start)}${item.value}${line.slice(cursorCol)}`;
    return { lines: next, cursorLine, cursorCol: start + item.value.length };
  },
};

function isProvider(value: unknown): value is AutocompleteProvider {
  return typeof value === "object" && value !== null
    && typeof Reflect.get(value, "getSuggestions") === "function"
    && typeof Reflect.get(value, "applyCompletion") === "function";
}

/** The composer's text and cursor offset as pi's editor holds them: lines, and the cursor's line and column. */
function linesAt(text: string, cursor: number): { lines: string[]; cursorLine: number; cursorCol: number } {
  const lines = text.split("\n");
  let remaining = Math.max(0, Math.min(cursor, text.length));
  for (const [index, line] of lines.entries()) {
    if (remaining <= line.length) return { lines, cursorLine: index, cursorCol: remaining };
    remaining -= line.length + 1;
  }
  const last = lines.length - 1;
  return { lines, cursorLine: last, cursorCol: lines[last]?.length ?? 0 };
}

function appliedText(result: unknown): ExtensionCompletionApplied {
  const lines: unknown = typeof result === "object" && result !== null ? Reflect.get(result, "lines") : undefined;
  const cursorLine: unknown = typeof result === "object" && result !== null ? Reflect.get(result, "cursorLine") : undefined;
  const cursorCol: unknown = typeof result === "object" && result !== null ? Reflect.get(result, "cursorCol") : undefined;
  if (!Array.isArray(lines) || typeof cursorLine !== "number" || typeof cursorCol !== "number") throw new Error("applyCompletion answered no lines and cursor");
  const texts = lines.map((line: unknown) => (typeof line === "string" ? line : ""));
  const before = texts.slice(0, Math.max(0, cursorLine)).reduce((sum, line) => sum + line.length + 1, 0);
  const text = texts.join("\n");
  return { text, cursor: Math.max(0, Math.min(text.length, before + cursorCol)) };
}

function boundedSuggestions(answer: unknown): ExtensionCompletionSuggestions {
  if (typeof answer !== "object" || answer === null) return NO_SUGGESTIONS;
  const prefix: unknown = Reflect.get(answer, "prefix");
  const items: unknown = Reflect.get(answer, "items");
  if (typeof prefix !== "string" || !Array.isArray(items)) return NO_SUGGESTIONS;
  return {
    prefix: prefix.slice(0, COMPLETION_FIELD_MAX),
    items: items.flatMap((entry: unknown) => completionItem(entry)).slice(0, COMPLETION_ITEMS_MAX),
  };
}

function completionItem(entry: unknown): ExtensionCompletionItem[] {
  if (typeof entry !== "object" || entry === null) return [];
  const value: unknown = Reflect.get(entry, "value");
  const label: unknown = Reflect.get(entry, "label");
  const description: unknown = Reflect.get(entry, "description");
  if (typeof value !== "string" || value === "" || value.length > COMPLETION_FIELD_MAX) return [];
  return [{
    value,
    label: (typeof label === "string" && label !== "" ? label : value).slice(0, COMPLETION_FIELD_MAX),
    ...(typeof description === "string" && description !== "" ? { description: description.slice(0, COMPLETION_FIELD_MAX) } : {}),
  }];
}

/** An item a composer sends back to be applied; undefined when it is not one a stack could have suggested. */
export function readCompletionItem(entry: unknown): ExtensionCompletionItem | undefined {
  return completionItem(entry)[0];
}
