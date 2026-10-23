import type { TemplateResult } from "lit";
import type { ListItem } from "../../shared/pluginApiTypes";
import type { NavigateChoice } from "./navigateModel";

/**
 * What plugins add to the Navigate page's lists (r145): a label line on each item, entries in its
 * menu, and sections. The page asks through `NavigateListEntries` and stays a dumb executor; the
 * app answers from the plugin registry, completing each item with the facts only it holds, and
 * contains every plugin call, so nothing here can throw at the page.
 */

/** The lists sections are drawn by the page itself; a session list's sections join `sessionSections`. */
export type NavigateChoiceList = "machines" | "projects";

/** An item as the page names it: a machine by its id, which the app completes with its fleet facts. */
export type NavigateListSubject = { readonly list: "machines"; readonly machineId: string } | Exclude<ListItem, { readonly list: "machines" }>;

export interface NavigateListLabel {
  readonly id: string;
  readonly content: TemplateResult;
}

/** A plugin's menu entry; `run` never throws or rejects, the app reports a failure itself. */
export interface NavigateListAction {
  readonly id: string;
  readonly title: string;
  readonly run: () => void;
}

export interface NavigateListSection {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly foldedByDefault?: boolean;
  readonly claims: (subject: NavigateListSubject) => boolean;
}

export interface NavigateListEntries {
  readonly labels: (subject: NavigateListSubject) => readonly NavigateListLabel[];
  readonly actions: (subject: NavigateListSubject) => readonly NavigateListAction[];
  readonly sections: (list: NavigateChoiceList) => readonly NavigateListSection[];
}

export interface NavigateChoiceSection {
  readonly id: string;
  readonly title: string;
  readonly foldedByDefault?: boolean;
  readonly choices: readonly NavigateChoice[];
}

const PINNED_PROJECTS: NavigateListSection = { id: "pinned", title: "Pinned", order: 100, claims: (subject) => subject.list === "projects" && subject.pinned };
const OTHER: NavigateListSection = { id: "other", title: "Other", order: 900, claims: () => true };

/** Core's sections of each list, which stand only beside a contributed one. */
const CORE_CHOICE_SECTIONS: Readonly<Record<NavigateChoiceList, readonly NavigateListSection[]>> = {
  machines: [OTHER],
  projects: [PINNED_PROJECTS, OTHER],
};

/**
 * A machines or projects list in sections, or undefined while no item lands in a plugin's section,
 * so the list looks exactly as it did before sections (a lone Other heading over the whole list, the
 * live check of 2026-10-23, said nothing). Each choice lands in the first section, by order, that
 * claims it, keeping the order the list gave it; Other takes only what no section claims, so a
 * section ordered after Other still receives its items. A section with nothing in it is left out.
 */
export function navigateChoiceSections(
  list: NavigateChoiceList,
  choices: readonly NavigateChoice[],
  contributed: readonly NavigateListSection[],
  subjectOf: (choice: NavigateChoice) => NavigateListSubject,
): NavigateChoiceSection[] | undefined {
  if (contributed.length === 0) return undefined;
  const coreIds = new Set(CORE_CHOICE_SECTIONS[list].map((section) => section.id));
  const definitions = [...CORE_CHOICE_SECTIONS[list], ...contributed.filter((section) => !coreIds.has(section.id))]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const claiming = definitions.filter((definition) => definition.id !== OTHER.id);
  const bySection = new Map<string, NavigateChoice[]>();
  for (const choice of choices) {
    const subject = subjectOf(choice);
    const section = claiming.find((definition) => definition.claims(subject)) ?? OTHER;
    bySection.set(section.id, [...(bySection.get(section.id) ?? []), choice]);
  }
  if (!contributed.some((section) => bySection.has(section.id))) return undefined;
  return definitions.flatMap((definition) => {
    const members = bySection.get(definition.id) ?? [];
    return members.length === 0 ? [] : [{ id: definition.id, title: definition.title, ...(definition.foldedByDefault === true ? { foldedByDefault: true } : {}), choices: members }];
  });
}

/**
 * A full order with one part of it reordered: the part's ids take the places they held, in the
 * part's new order, and every other id keeps its place. Dragging inside a section saves the whole
 * list this way.
 */
export function mergedOrder(full: readonly string[], part: readonly string[]): string[] {
  const moving = new Set(part);
  const placed = part.filter((id) => full.includes(id));
  let next = 0;
  return full.map((id) => {
    if (!moving.has(id)) return id;
    const replacement = placed[next] ?? id;
    next += 1;
    return replacement;
  });
}
