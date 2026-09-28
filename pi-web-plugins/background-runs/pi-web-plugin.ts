import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { backgroundRunCountOf, backgroundRunNote } from "./backgroundRunNote.js";
import { noticeLabel, taskNotice } from "./taskNotice.js";
import type { TaskInput } from "./backgroundTaskRows.js";
import "./backgroundTasksElement.js";

function tasksOf(context: { state?: { backgroundTasks?: readonly TaskInput[] | undefined } | undefined }): readonly TaskInput[] {
  return context.state?.backgroundTasks ?? [];
}

function runningCount(context: Parameters<typeof tasksOf>[0]): number {
  return tasksOf(context).filter((task) => task.status === "running").length;
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
          visible: (context) => tasksOf(context).length > 0,
          badge: (context) => {
            const running = runningCount(context);
            return running === 0 ? undefined : running;
          },
          summary: (context) => {
            const running = runningCount(context);
            return running > 0 ? `${String(running)} running` : `${String(tasksOf(context).length)} finished`;
          },
          render: (context) => html`<pi-web-background-tasks .tasks=${tasksOf(context)}></pi-web-background-tasks>`,
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
          note: (context) => backgroundRunNote(backgroundRunCountOf(context.status)),
        },
      ],
    },
  }),
};

export default plugin;
