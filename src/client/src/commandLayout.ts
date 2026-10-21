/**
 * How a command box lays out a long shell command (owner, 2026-10-21: "nice, but copying must not
 * change"). Left to itself the browser wraps a command after any hyphen or slash, so a flag such as
 * `--then-restart-web-and-session-daemon` splits in two. The box instead draws each word, each stage
 * of a pipeline or list (up to `&&`, `||`, `|`, `|&` or `;` outside quotes) and each piece of a long
 * word as its own unbreakable box, so lines break between words, a stage that fits moves whole to the
 * next line, and a path or URL longer than the line breaks after `/` or `=` or before `?` or `&`.
 *
 * Invariant: the layout only groups the command's characters; read in order, `lead`, then every
 * word's pieces and `gapAfter`, then every stage's `gapAfter`, is the command unchanged, so the
 * copied, selected and spoken text is the command byte for byte.
 */
export interface CommandLayout {
  readonly lead: string;
  readonly stages: readonly CommandStage[];
}

export interface CommandStage {
  readonly words: readonly CommandWord[];
  readonly gapAfter: string;
}

export interface CommandWord {
  readonly pieces: readonly string[];
  readonly gapAfter: string;
}

const STAGE_ENDS: ReadonlySet<string> = new Set(["&&", "||", "|", "|&", ";"]);
const URL_TEXT = /[\w%.~-]/;

export function commandLayout(command: string): CommandLayout {
  const lead = /^ */.exec(command)?.[0] ?? "";
  const stages: CommandStage[] = [];
  let words: CommandWord[] = [];
  let quote = "";
  for (const [, text = "", gap = ""] of command.slice(lead.length).matchAll(/([^ ]+)( *)/g)) {
    const startedOutside = quote === "";
    quote = quoteAfter(text, quote);
    words.push({ pieces: wordPieces(text), gapAfter: gap });
    if (quote === "" && ((startedOutside && STAGE_ENDS.has(text)) || text.endsWith(";"))) {
      stages.push(closeStage(words));
      words = [];
    }
  }
  if (words.length > 0) stages.push(closeStage(words));
  return { lead, stages };
}

/** The gap after a stage's last word belongs between stages, outside the stage's box. */
function closeStage(words: readonly CommandWord[]): CommandStage {
  const last = words[words.length - 1];
  if (last === undefined) return { words, gapAfter: "" };
  return { words: [...words.slice(0, -1), { pieces: last.pieces, gapAfter: "" }], gapAfter: last.gapAfter };
}

function quoteAfter(text: string, quote: string): string {
  let open = quote;
  for (const ch of text) {
    if (open === "" && (ch === "'" || ch === "\"")) open = ch;
    else if (ch === open) open = "";
  }
  return open;
}

function wordPieces(word: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  for (let index = 1; index < word.length; index += 1) {
    if (!breaksBefore(word, index)) continue;
    pieces.push(word.slice(start, index));
    start = index;
  }
  pieces.push(word.slice(start));
  return pieces;
}

/** After a single `/` (never inside `//`) or `=`, and before a `?` or `&` that follows URL text. */
function breaksBefore(word: string, index: number): boolean {
  const before = word.charAt(index - 1);
  const at = word.charAt(index);
  if (before === "/") return at !== "/" && index >= 2 && word.charAt(index - 2) !== "/";
  if (before === "=") return true;
  return (at === "?" || at === "&") && URL_TEXT.test(before);
}
