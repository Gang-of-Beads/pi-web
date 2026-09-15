/**
 * What a settled code block becomes once a plugin may claim its language.
 *
 * The transcript parses and sanitizes markdown exactly as before; this is the
 * decision taken afterwards, per block, from the block's info-string language
 * and whether anybody claims it. Every state is named so the renderer stays a
 * dumb executor and the tests can enumerate the table.
 */
export type CodeFenceVerdict =
  | { kind: "plain"; reason: "no-language" | "unclaimed" }
  | { kind: "claimed"; language: string };

export const CODE_FENCE_LANGUAGE_CLASS = /^language-([a-z0-9_+.#-]+)$/iu;

export function codeFenceLanguage(codeClassName: string): string | undefined {
  for (const token of codeClassName.split(/\s+/u)) {
    const match = CODE_FENCE_LANGUAGE_CLASS.exec(token);
    if (match?.[1] !== undefined) return match[1].toLowerCase();
  }
  return undefined;
}

export function codeFenceVerdict(codeClassName: string, hasClaimant: (language: string) => boolean): CodeFenceVerdict {
  const language = codeFenceLanguage(codeClassName);
  if (language === undefined) return { kind: "plain", reason: "no-language" };
  return hasClaimant(language) ? { kind: "claimed", language } : { kind: "plain", reason: "unclaimed" };
}
