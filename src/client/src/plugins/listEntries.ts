import type { FleetMachine } from "../../../shared/pluginApiTypes";
import { isRecord } from "../../../shared/unknownValues";
import type { NavigateChoiceList, NavigateListAction, NavigateListEntries, NavigateListLabel, NavigateListSection, NavigateListSubject } from "../navigateListEntries";
import type { SessionSectionDefinition, SessionSectionSubject } from "../sessionOrder";
import { askPlugin } from "./pluginContainment";
import type { PluginRegistry } from "./registry";
import type { ListItem, ListItemAction, ListItemContext, ListKind, ListSection } from "./types";

export interface ListEntryHost {
  readonly registry: Pick<PluginRegistry, "getListLabels" | "getListActions" | "getListSections">;
  /** This PI WEB's fleet facts of a machine it lists; undefined for one the roster no longer holds. */
  readonly machine: (machineId: string) => FleetMachine | undefined;
  /** Draw the lists again, for a plugin whose own data changed. */
  readonly requestRender: () => void;
  /** Tell the reader a plugin's menu entry failed, in the host's words. */
  readonly actionFailed: (title: string, error: unknown) => void;
}

/** A section as the port keeps it: a host id no other plugin can take, and a contained claim. */
interface ContributedSection {
  readonly id: string;
  readonly section: ListSection;
  readonly claims: (item: ListItem) => boolean;
}

/**
 * The list contributions (`listLabels`, `listActions`, `listSections`, r145) as the Navigate page
 * and the session search ask for them. `sessionSections` reach it as `listSections` of the sessions
 * list (r150), so one rule covers both spellings.
 *
 * Every call into a plugin is contained, and so is what it returns: a call that throws, or an answer
 * that is not the documented shape (an entry or a section missing its id, title or function), draws
 * nothing, offers nothing or claims nothing for that draw, logged once per contribution and member
 * (`askPlugin`). A menu entry's run is reported to the reader each time, because the reader asked
 * for it.
 *
 * Projects and sessions items are answered by the plugins of the machine the item belongs to, so a
 * row still showing the previous machine's session right after a switch never meets the new
 * machine's plugins (data carries its scope).
 */
export class ListEntryPort {
  constructor(private readonly host: ListEntryHost) {}

  /** What the Navigate page asks of its lists while `shownMachineId`'s are shown. */
  forMachine(shownMachineId: string): NavigateListEntries {
    return {
      labels: (subject) => this.labels(subject, shownMachineId),
      actions: (subject) => this.actions(subject, shownMachineId),
      sections: (list) => this.choiceSections(list, shownMachineId),
    };
  }

  /** The contributed sections of every list of sessions, in the shape `sessionSections` merges with core's. */
  sessionSections(rowsMachineId: string): SessionSectionDefinition[] {
    return this.contributedSections("sessions", rowsMachineId).map(({ id, section, claims }) => ({
      id,
      title: section.title,
      order: section.order,
      ...(section.foldedByDefault === true ? { foldedByDefault: true } : {}),
      claims: (subject: SessionSectionSubject) => claims({ list: "sessions", ...subject }),
    }));
  }

  private labels(subject: NavigateListSubject, shownMachineId: string): NavigateListLabel[] {
    const item = this.itemOf(subject);
    if (item === undefined) return [];
    return this.host.registry.getListLabels(item.list, answeringMachine(subject, shownMachineId)).flatMap((label) => {
      const content = askPlugin(label, "render", "its label is not drawn on this item", () => label.render(this.itemContext(item)));
      return content === undefined ? [] : [{ id: label.id, content }];
    });
  }

  private actions(subject: NavigateListSubject, shownMachineId: string): NavigateListAction[] {
    const item = this.itemOf(subject);
    if (item === undefined) return [];
    return this.host.registry.getListActions(item.list, answeringMachine(subject, shownMachineId)).flatMap((contribution) => {
      const offered = askPlugin(contribution, "actions", "its entries are not offered in this menu", () => wellFormed(contribution.actions(this.itemContext(item)), isListItemAction, "an entry that is not { id, title, run }")) ?? [];
      return offered.map((action) => ({
        id: `${contribution.id}/${action.id}`,
        title: action.title,
        run: () => {
          void Promise.resolve().then(() => action.run()).catch((error: unknown) => {
            console.error(`[plugin] ${contribution.id} failed to run ${action.id}`, error);
            this.host.actionFailed(action.title, error);
          });
        },
      }));
    });
  }

  private choiceSections(list: NavigateChoiceList, shownMachineId: string): NavigateListSection[] {
    return this.contributedSections(list, shownMachineId).map(({ id, section, claims }) => ({
      id,
      title: section.title,
      order: section.order,
      ...(section.foldedByDefault === true ? { foldedByDefault: true } : {}),
      claims: (subject: NavigateListSubject) => {
        const item = this.itemOf(subject);
        return item !== undefined && claims(item);
      },
    }));
  }

  /**
   * Each contribution's sections under host ids no other plugin's can take: the contribution's own
   * qualified id and the section's id. A section id a contribution repeats keeps its first.
   */
  private contributedSections(list: ListKind, machineId: string): ContributedSection[] {
    return this.host.registry.getListSections(list, machineId).flatMap((contribution) => {
      const sections = askPlugin(contribution, "sections", "its sections are not drawn", () => wellFormed(contribution.sections(Object.freeze({ list, requestRender: this.host.requestRender })), isListSection, "a section that is not { id, title, order, claims }")) ?? [];
      const seen = new Set<string>();
      return sections.flatMap((section) => {
        const id = `${contribution.id}/${section.id}`;
        if (seen.has(id)) return [];
        seen.add(id);
        return [{ id, section, claims: (item: ListItem) => askPlugin(contribution, `claims of ${section.id}`, "the section claims no item", () => section.claims(item)) === true }];
      });
    });
  }

  private itemOf(subject: NavigateListSubject): ListItem | undefined {
    if (subject.list !== "machines") return Object.freeze({ ...subject });
    const machine = this.host.machine(subject.machineId);
    return machine === undefined ? undefined : Object.freeze({ list: "machines", machine });
  }

  private itemContext(item: ListItem): ListItemContext {
    return Object.freeze({ item, requestRender: this.host.requestRender });
  }
}

/** The machine whose plugins answer for an item: the item's own for projects and sessions; the Machines list is this PI WEB's. */
function answeringMachine(subject: NavigateListSubject, shownMachineId: string): string {
  return subject.list === "machines" ? shownMachineId : subject.machineId;
}

/** A plugin's answer as an array of well-formed members, or a throw the containment logs: a JavaScript plugin can return anything. */
function wellFormed<T>(answer: unknown, isMember: (value: unknown) => value is T, what: string): T[] {
  if (!Array.isArray(answer)) throw new Error("the answer is not an array");
  return answer.map((member: unknown) => {
    if (!isMember(member)) throw new Error(`the answer holds ${what}`);
    return member;
  });
}

function isListItemAction(value: unknown): value is ListItemAction {
  return isRecord(value) && typeof value["id"] === "string" && typeof value["title"] === "string" && typeof value["run"] === "function";
}

function isListSection(value: unknown): value is ListSection {
  return isRecord(value)
    && typeof value["id"] === "string"
    && typeof value["title"] === "string"
    && typeof value["order"] === "number"
    && typeof value["claims"] === "function"
    && (value["foldedByDefault"] === undefined || typeof value["foldedByDefault"] === "boolean");
}
