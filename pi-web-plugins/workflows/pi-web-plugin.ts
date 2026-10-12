import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { defineWorkflowCard } from "./workflowCardElement.js";
import { workflowProgress } from "./workflowProgress.js";

/**
 * Draws the pi-dynamic-workflows extension's `workflow` tool as a progress card (owner,
 * 2026-10-12, mockup W2). The extension streams a snapshot of the run in its tool updates'
 * details; a call whose details are not one yet (it just started, or another extension took the
 * name) is left to the host's own tool card.
 */
const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Workflows",
  activate: ({ html }) => {
    defineWorkflowCard();
    return {
      contributions: {
        toolRenderers: [
          {
            id: "workflow-progress",
            toolName: "workflow",
            render: (view) => {
              const progress = workflowProgress(view.details);
              if (progress === undefined) return undefined;
              return html`<pi-web-workflow-card .progress=${progress} .call=${view.status}></pi-web-workflow-card>`;
            },
          },
        ],
      },
    };
  },
};

export default plugin;
