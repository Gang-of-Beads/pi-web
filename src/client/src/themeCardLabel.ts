/**
 * What a theme card says about itself beyond its own name.
 *
 * Three facts can be true of a card and only one of them used to be shown: the
 * card is the one you picked, the card is the one being rendered, and - when
 * "follow the system" is on - those are different cards. The interface marked
 * only the second, on the other card, so picking "Clay Paper" and getting a
 * dark interface left the chosen card saying nothing at all and the reader
 * working out the rule for themselves.
 *
 * The choice is not overridden silently now: the card you picked says that
 * something else is in use, which is the fact that was missing.
 */
export function themeCardSuffix(input: { selected: boolean; active: boolean; autoOverriding: boolean }): string {
  if (input.autoOverriding) return " · chosen, but following your system";
  if (input.active && !input.selected) return " · in use";
  return "";
}
