import { html, type TemplateResult } from "lit";
import type { DrawerSectionContext, PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { rememberGoalsHostUi } from "./browser/hostUi.js";
import { defineGoalPanel } from "./browser/defineGoalPanel.js";
import { GoalsReader } from "./browser/goalsReader.js";
import { goalsForKey } from "./browser/goalsLoad.js";
import type { GoalRecordSummary } from "./browser/goalTypes.js";

/**
 * Goals as a plugin.
 *
 * The records live in a workspace's own directory, so the plugin reads them
 * itself through its own operation rather than being handed rows by the host:
 * a feature whose view lives here and whose state lives in the host is the
 * split this boundary exists to remove.
 *
 * Absence stays three states. A workspace that has been read and has no goals
 * is not the same as one whose read failed, and neither is the same as one
 * nobody has read yet.
 */

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Goals",
  activate: (context) => {
    rememberGoalsHostUi(context.ui);
    defineGoalPanel();

    let redraw: (() => void) | undefined;
    const reader = new GoalsReader(
      context.callOperation ?? (() => Promise.reject(new Error("This host does not offer plugin requests."))),
      () => { redraw?.(); },
    );
    let readFor: string | undefined;

    function sectionFor(section: DrawerSectionContext): TemplateResult {
      const workspacePath = section.workspacePath;
      if (workspacePath === undefined) return html`<div class="goals-unknown">No workspace is selected.</div>`;
      if (readFor !== workspacePath) {
        readFor = workspacePath;
        void reader.read(workspacePath, section.sessionId === "" ? undefined : undefined);
      }
      return html`<goal-panel .goalsLoad=${goalsForKey(reader.current(), workspacePath)}></goal-panel>`;
    }

    return {
      contributions: {
        drawerSections: [{
          id: "goals",
          title: "Goals",
          order: 30,
          available: (section) => availability(reader.current().data, section),
          badge: (section) => badgeFor(reader.current().data, section),
          render: sectionFor,
        }],
      },
      dispose: () => { redraw = undefined; },
    };
  },
};

/**
 * Undefined while the plugin has not read this workspace yet: the shell keeps
 * the tab, because a section that has not looked is not a section with
 * nothing in it.
 */
function availability(goals: readonly GoalRecordSummary[], section: DrawerSectionContext): boolean | undefined {
  if (section.workspacePath === undefined) return false;
  return goals.length > 0 ? true : undefined;
}

function badgeFor(goals: readonly GoalRecordSummary[], section: DrawerSectionContext): number | undefined {
  if (section.workspacePath === undefined || goals.length === 0) return undefined;
  return goals.length;
}

export default plugin;
