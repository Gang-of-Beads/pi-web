import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { backgroundRunCountOf, backgroundRunNote } from "./backgroundRunNote.js";
import { noticeLabel, taskNotice } from "./taskNotice.js";

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Background Runs",
  activate: ({ html }) => ({
    contributions: {
      messageRenderers: [
        {
          id: "message.background-task-notification",
          tag: "background-task-notification",
          render: (view) => html`<strong>Background task</strong><div>${noticeLabel(taskNotice(view.payload))}</div>`,
        },
      ],
      activityNotes: [
        {
          id: "activity.background-runs",
          order: 100,
          note: (context) => backgroundRunNote(backgroundRunCountOf(context.status), context.idle),
        },
      ],
    },
  }),
};

export default plugin;
