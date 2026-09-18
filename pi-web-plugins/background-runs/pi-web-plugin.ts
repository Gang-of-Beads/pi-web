import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { backgroundRunCountOf, backgroundRunNote } from "./backgroundRunNote.js";

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Background Runs",
  activate: () => ({
    contributions: {
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
