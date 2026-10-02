import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { backgroundRunCountOf, backgroundRunNote } from "./backgroundRunNote.js";
import { noticeLabel, taskNotice } from "./taskNotice.js";
import type { TaskInput, TasksRead } from "./backgroundTaskRows.js";
import "./backgroundTasksElement.js";

interface TasksContext {
  state?: { backgroundTasks?: readonly TaskInput[] | undefined; backgroundTasksRead?: TasksRead | undefined; selectedSession?: unknown } | undefined;
}

function tasksOf(context: TasksContext): readonly TaskInput[] {
  return context.state?.backgroundTasks ?? [];
}

function readOf(context: TasksContext): TasksRead {
  return context.state?.backgroundTasksRead ?? "unread";
}

function runningCount(context: Parameters<typeof tasksOf>[0]): number {
  return tasksOf(context).filter((task) => task.status === "running").length;
}

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Background Runs",
  activate: ({ html, svg }) => ({
    contributions: {
      workspacePanels: [
        {
          id: "workspace.background",
          title: "Background",
          icon: svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></svg>`,
          order: 65,
          visible: (context) => context.state?.selectedSession !== undefined,
          badge: (context) => {
            const running = runningCount(context);
            return running === 0 ? undefined : running;
          },
          render: (context) => html`<pi-web-background-tasks .tasks=${tasksOf(context)} .read=${readOf(context)}></pi-web-background-tasks>`,
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
