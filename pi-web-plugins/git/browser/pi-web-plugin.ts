import type { PiWebPlugin } from "@vincenthanxiaodu/pi-web/plugin-api";
import { createGitBrowserContributions } from "./git-panel.js";

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Git",
  activate: ({ pluginId, runtimePluginId, html, svg }) => ({
    contributions: createGitBrowserContributions(pluginId, runtimePluginId, html, svg),
  }),
};

export default plugin;
