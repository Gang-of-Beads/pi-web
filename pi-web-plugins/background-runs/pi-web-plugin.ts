import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { backgroundRunCountOf, backgroundRunNote } from "./backgroundRunNote.js";
import { noticeLabel, taskNotice } from "./taskNotice.js";

function runningTasks(context: { state?: { backgroundTasks?: readonly { status: string }[] | undefined } | undefined }): readonly { status: string }[] {
  return (context.state?.backgroundTasks ?? []).filter((task) => task.status === "running");
}

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Background Runs",
  activate: ({ html }) => ({
    contributions: {
      workspacePanels: [
        {
          id: "workspace.background",
          title: "Background",
          order: 65,
          topEntry: true,
          running: (context) => runningTasks(context).length > 0,
          badge: (context) => {
            const running = runningTasks(context).length;
            return running === 0 ? undefined : running;
          },
          summary: (context) => {
            const tasks = context.state?.backgroundTasks ?? [];
            if (tasks.length === 0) return undefined;
            const running = runningTasks(context).length;
            return running === 0 ? `${String(tasks.length)} finished` : `${String(running)} running`;
          },
          render: (context) => html`
            <div class="background-rows">
              ${(context.state?.backgroundTasks ?? []).map((task) => html`
                <div class=${`background-row ${task.status}`}><span>${task.name}</span><span>${task.status}</span></div>
              `)}
            </div>
          `,
        },
      ],
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
