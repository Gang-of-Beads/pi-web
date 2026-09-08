import type { PiWebPlugin, PluginActivationContext } from "@gang-of-beads/pi-web/plugin-api";
import { html } from "lit";
import { rememberGoalsHostUi } from "./hostUi.js";
import { badgeFor, type GoalsSectionState } from "./goalsSectionElement.js";
import type { GoalRecordSummary } from "./goalRecords.js";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isGoalSummary = (value: unknown): value is GoalRecordSummary => {
  if (!isRecord(value)) return false;
  return typeof value["id"] === "string"
    && typeof value["objective"] === "string"
    && typeof value["status"] === "string"
    && typeof value["tasksTotal"] === "number"
    && typeof value["tasksDone"] === "number"
    && typeof value["updatedAt"] === "string";
};

/** The goals surface as a plugin: one drawer section carrying the workspace's
 *  leading goal record. The section owns its read-through-cache keyed by the
 *  workspace path it was asked for - a read that lands for another workspace
 *  never reaches this one (the scope-carrying rule the host surfaces follow). */
const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Goals",
  activate: (context: PluginActivationContext) => {
    rememberGoalsHostUi(context.ui);
    const callOperation = context.callOperation;
    let cache: { key: string; answer?: Awaited<ReturnType<typeof listGoals>> } | undefined;

    const listGoals = async (workspacePath: string, sessionCwd: string | undefined): Promise<GoalsSectionState> => {
      if (callOperation === undefined) return { goals: [], brokenFiles: 0 };
      const input = sessionCwd === undefined ? { workspacePath } : { workspacePath, sessionCwd };
      const answer = await callOperation("goals.list", input);
      if (!isRecord(answer)) return { goals: [], brokenFiles: 0 };
      const rawGoals: unknown[] = Array.isArray(answer["goals"]) ? answer["goals"] : [];
      return { goals: rawGoals.filter(isGoalSummary), brokenFiles: 0 };
    };

    const read = (workspacePath: string, sessionCwd: string | undefined, requestUpdate: () => void): void => {
      void listGoals(workspacePath, sessionCwd)
        .then((state) => {
          if (cache?.key !== workspacePath) return;
          cache = { key: workspacePath, answer: state };
          requestUpdate();
        })
        .catch(() => {
          if (cache?.key !== workspacePath) return;
          cache = { key: workspacePath, answer: { goals: [], brokenFiles: 0 } };
          requestUpdate();
        });
    };

    return {
      contributions: {
        drawerSections: [
          {
            id: "goals",
            title: "Goals",
            order: 30,
            available: (section) => {
              if (section.workspacePath === undefined) return false;
              if (cache?.key === section.workspacePath) return (cache.answer?.goals.length ?? 0) > 0;
              return undefined;
            },
            badge: (section) => (cache?.key === section.workspacePath ? badgeFor(cache?.answer) : undefined),
            render: (section) => {
              const workspacePath = section.workspacePath;
              if (workspacePath === undefined) return html`<pi-web-goals-section .state=${undefined}></pi-web-goals-section>`;
              if (cache?.key !== workspacePath) {
                cache = { key: workspacePath };
                read(workspacePath, section.sessionCwd, section.requestUpdate);
              }
              return html`<pi-web-goals-section
                .state=${cache.answer}
                .onRefresh=${() => { read(workspacePath, section.sessionCwd, section.requestUpdate); }}
              ></pi-web-goals-section>`;
            },
          },
        ],
      },
    };
  },
};

export default plugin;
