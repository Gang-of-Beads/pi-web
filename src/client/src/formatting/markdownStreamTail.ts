import type { Token, Tokens } from "marked";

type MarkdownTextTailTag = "P" | "LI" | "H1" | "H2" | "H3" | "H4" | "H5" | "H6" | "TD" | "TH";
type TrailingSpace = "preserve" | "trim";
type TailContext = "block" | "list-item" | "list-descendant";
export type MarkdownStreamTail =
  | { readonly kind: "none" }
  | { readonly kind: "code"; readonly space: TrailingSpace }
  | { readonly kind: "text"; readonly tag: MarkdownTextTailTag; readonly space: TrailingSpace };

const NONE: MarkdownStreamTail = { kind: "none" };
const HEADING_TAGS: Partial<Record<number, MarkdownTextTailTag>> = { 1: "H1", 2: "H2", 3: "H3", 4: "H4", 5: "H5", 6: "H6" };
const SPACE_BY_CONTEXT: Record<TailContext, TrailingSpace> = { block: "preserve", "list-item": "trim", "list-descendant": "trim" };
const QUOTE_CONTEXT: Record<TailContext, TailContext> = { block: "block", "list-item": "list-descendant", "list-descendant": "list-descendant" };

function isList(token: Token): token is Tokens.List { return token.type === "list"; }
function isQuote(token: Token): token is Tokens.Blockquote { return token.type === "blockquote"; }
function isCode(token: Token): token is Tokens.Code { return token.type === "code"; }
function isHeading(token: Token): token is Tokens.Heading { return token.type === "heading"; }
function isParagraph(token: Token): token is Tokens.Paragraph { return token.type === "paragraph"; }
function isText(token: Token): token is Tokens.Text { return token.type === "text"; }
function isTable(token: Token): token is Tokens.Table { return token.type === "table"; }

function plainTextTail(tokens: readonly Token[], tag: MarkdownTextTailTag, space: TrailingSpace): MarkdownStreamTail {
  return tokens.at(-1)?.type === "text" ? { kind: "text", tag, space } : NONE;
}

function codeTail(token: Tokens.Code, space: TrailingSpace): MarkdownStreamTail {
  const line = token.raw.split("\n").at(-1) ?? "";
  if (line.trim() === "") return NONE;
  if (token.codeBlockStyle === "indented") return { kind: "code", space };
  const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*\n/u.exec(token.raw);
  const marker = opening?.[1];
  if (opening === null || marker === undefined) return NONE;
  const body = token.raw.slice(opening[0].length);
  const closing = new RegExp(`^ {0,3}${marker.charAt(0)}{${String(marker.length)},}[ \\t]*$`, "u");
  if (body !== "" && closing.test(body.trimEnd().split("\n").at(-1) ?? "")) return NONE;
  return /^[ \t]*[`~]*[ \t]*$/u.test(line) ? NONE : { kind: "code", space };
}

function hasPlainTableWidth(token: Tokens.Table): boolean {
  const raw = token.raw.trimEnd();
  const line = raw.slice(raw.lastIndexOf("\n") + 1).trim();
  if (line.includes("\\") || line.includes("`")) return false;
  const cells = line.split("|");
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells.length === token.header.length;
}

function blockTail(tokens: readonly Token[], context: TailContext = "block"): MarkdownStreamTail {
  const token = tokens.at(-1);
  if (token === undefined) return NONE;
  if (isList(token)) return blockTail(token.items.at(-1)?.tokens ?? [], "list-item");
  if (isQuote(token)) return blockTail(token.tokens, QUOTE_CONTEXT[context]);
  if (isCode(token)) return codeTail(token, SPACE_BY_CONTEXT[context]);
  if (isParagraph(token)) return plainTextTail(token.tokens, "P", SPACE_BY_CONTEXT[context]);
  if (isText(token) && context === "list-item") return plainTextTail(token.tokens ?? [token], "LI", "trim");
  if (isHeading(token)) {
    const tag = HEADING_TAGS[token.depth];
    return tag !== undefined && /^ {0,3}#/u.test(token.raw) ? plainTextTail(token.tokens, tag, "trim") : NONE;
  }
  if (isTable(token)) {
    const row = token.rows.at(-1);
    const cell = (row ?? token.header).at(-1);
    if (cell === undefined || cell.text === "" || !hasPlainTableWidth(token) || !token.raw.trimEnd().endsWith(cell.text)) return NONE;
    return plainTextTail(cell.tokens, row === undefined ? "TH" : "TD", "trim");
  }
  return NONE;
}

/** Only parser-confirmed EOF leaves may receive literal text; ambiguity goes back to marked. */
export function describeMarkdownStreamTail(tokens: readonly Token[], source: string): MarkdownStreamTail {
  if (/[\r\n\t]$/u.test(source)) return NONE;
  const normalized = source.replace(/\r\n?/gu, "\n");
  let offset = 0;
  for (const token of tokens) {
    if (!normalized.startsWith(token.raw, offset)) return NONE;
    offset += token.raw.length;
  }
  if (offset !== normalized.length) return NONE;
  const tail = blockTail(tokens);
  if (tail.kind === "none" || (tail.space === "trim" && /\s$/u.test(source))) return NONE;
  if (tail.kind === "code" && tail.space === "preserve") return tail;
  const lastLine = normalized.slice(normalized.lastIndexOf("\n") + 1).trim();
  if (lastLine === "" || /^\d+[.)]?$/u.test(lastLine) || /[\p{P}+<=>|~`\\]$/u.test(normalized.trimEnd())) return NONE;
  return tail;
}

export function canAppendMarkdownTail(tail: MarkdownStreamTail, suffix: string): boolean {
  if (tail.kind === "none" || /[\r\n\t]/u.test(suffix)) return false;
  if (tail.space === "trim" && /\s$/u.test(suffix)) return false;
  return (tail.kind === "code" && tail.space === "preserve") || !/[\p{P}<>|~`\\]/u.test(suffix);
}
