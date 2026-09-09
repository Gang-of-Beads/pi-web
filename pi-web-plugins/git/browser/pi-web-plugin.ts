import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { createGitBrowserContributions } from "./git-panel.js";
import { rememberGitHostUi } from "./hostUi.js";

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Git",
  activate: ({ pluginId, runtimePluginId, html, svg, ui }) => {
    rememberGitHostUi(ui);
    return { contributions: createGitBrowserContributions(pluginId, runtimePluginId, html, svg) };
  },
};

export default plugin;
