import type { PiWebServerPlugin, ServerFact } from "@gang-of-beads/pi-web/server-plugin-api";

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Server declaration fixture",
  activate: (context) => {
    const ended: ServerFact<"run.ended">[] = [];
    const stopListening = context.events?.on("run.ended", (fact, signal) => {
      if (!signal.aborted) ended.push(fact);
    });
    context.events?.on("facts.resumed", (fact) => {
      if (fact.gap) ended.length = 0;
    });
    return {
      workspaceProvider: {
        probe: async () => "claim",
        list: async (project) => [{
          key: "main",
          path: project.path,
          label: project.name,
          isMain: true,
        }],
      },
      stop: () => { stopListening?.(); },
    };
  },
};

export default plugin;
