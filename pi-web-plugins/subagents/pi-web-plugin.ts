import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { defineSupervisorCard } from "./supervisorCardElement.js";
import { supervisorRequest } from "./supervisorRequest.js";
import { noticeSummary } from "./noticeSummary.js";

const NOTICE_TAGS = [
  "subagent-notify",
  "subagent-incremental-child-notify",
  "subagent_control_notice",
  "subagent_steering_notice",
  "subagent_supervisor_reply",
  "subagent-compaction-resume",
];

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Subagents",
  activate: ({ html }) => {
    defineSupervisorCard();
    return {
      contributions: {
        messageRenderers: [
          {
            id: "message.supervisor-request",
            tag: "subagent_supervisor_request",
            render: (view) => html`<pi-subagent-supervisor-card
              .request=${supervisorRequest(view.payload)}
              .onSend=${view.sendMessage}
              .onInsert=${view.insertIntoComposer}
            ></pi-subagent-supervisor-card>`,
          },
          ...NOTICE_TAGS.map((tag) => ({
            id: `message.${tag.replace(/_/gu, "-")}`,
            tag,
            render: (view: { payload: unknown }) => {
              const summary = noticeSummary(tag, view.payload);
              return html`<strong>${summary.title}</strong>${summary.detail === undefined ? null : html`<small>${summary.detail}</small>`}`;
            },
          })),
        ],
      },
    };
  },
};

export default plugin;
