import type { PiWebServerPlugin, PluginModelReply, ServerFact } from "@gang-of-beads/pi-web/server-plugin-api";

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
    const models = context.ports?.models;
    const summarise = async (text: string, signal: AbortSignal): Promise<string | undefined> => {
      const granted = (await models?.list())?.find((entry) => entry.state === "ready");
      if (models === undefined || granted === undefined) return undefined;
      const reply: PluginModelReply = await models.complete({ model: granted.model, reasoning: "off", maxTokens: 200, messages: [{ role: "user", text }] }, signal);
      return reply.kind === "answered" ? reply.text : undefined;
    };
    void summarise;
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
