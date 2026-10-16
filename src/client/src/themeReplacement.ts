import type { QualifiedContributionId, QualifiedThemeContribution } from "./plugins/types";

type ThemeChoice = Pick<QualifiedThemeContribution, "id" | "replacedBy">;

/** A declaration may point to a concrete theme; missing or chained targets retain its fallback. */
export function resolvedThemeId(id: QualifiedContributionId, choices: readonly ThemeChoice[]): QualifiedContributionId {
  const selected = choices.find((choice) => choice.id === id);
  const replacement = selected?.replacedBy;
  if (replacement === undefined) return id;
  const target = choices.find((choice) => choice.id === replacement && choice.replacedBy === undefined);
  return target?.id ?? id;
}
