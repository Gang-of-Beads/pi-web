import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { agentEventSummary } from "./eventSummary.js";

const TAGS = ["web-search-results", "agent-browser-script-session", "pi-accounts-selection"];

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Agent Events",
  activate: ({ html }) => ({
    contributions: {
      messageRenderers: TAGS.map((tag) => ({
        id: `message.${tag}`,
        tag,
        render: (view) => {
          const summary = agentEventSummary(tag, view.payload);
          return html`<strong>${summary.title}</strong>${summary.detail === undefined ? null : html`<small>${summary.detail}</small>`}`;
        },
      })),
    },
  }),
};

export default plugin;
