import type { JsonValue, PiWebServerPlugin, ServerPluginHealth } from "@gang-of-beads/pi-web/server-plugin-api";
import { createAzureSpeechTokenService, resolveAzureSpeechKey, type AzureSpeechKeySource } from "./server/azureSpeechToken.js";

/**
 * Voice's server half.
 *
 * Live transcription connects from the page straight to the speech service,
 * because putting a server in the audio path adds a hop to every syllable for
 * nothing. The page therefore needs a credential - but not the subscription
 * key, which could be used for anything and would be readable by anyone who
 * opened the developer tools. The key stays here and the page gets a token
 * that expires, for the live socket and the whole-clip upload alike.
 *
 * Unconfigured is a state, not a failure: the operation says the feature is
 * not configured, and why, rather than pretending to have minted something.
 */

const PRIVATE_KEY_PATH = "plugins.voice.serverSettings.azureSpeech.key";
const PUBLIC_KEY_PATH = "plugins.voice.settings.azureSpeech.key";

/** What the plugin list says about where the key comes from; for the kinds that mint no token, the message is also the token refusal reason. */
const KEY_SOURCE_HEALTH: Readonly<Record<AzureSpeechKeySource["kind"], ServerPluginHealth>> = {
  "server-settings": { status: "healthy" },
  "server-settings-and-public-copy": {
    status: "degraded",
    message: `A copy of the Azure Speech key is still in ${PUBLIC_KEY_PATH}, which browsers can read. Remove it; the key in ${PRIVATE_KEY_PATH} is the one used.`,
  },
  "public-settings": {
    status: "degraded",
    message: `The Azure Speech key is in ${PUBLIC_KEY_PATH}, which browsers can read. Move it to ${PRIVATE_KEY_PATH}.`,
  },
  "public-settings-on-older-host": {
    status: "degraded",
    message: `The Azure Speech key is in ${PUBLIC_KEY_PATH}, which browsers can read, and this PI WEB does not pass private settings to plugins. Upgrade PI WEB, then move the key to ${PRIVATE_KEY_PATH}.`,
  },
  "no-region": { status: "healthy", message: "Azure Speech is not configured on this machine: plugins.voice.settings.azureSpeech.region is not set." },
  "no-key": { status: "degraded", message: `No Azure Speech key is configured on this machine: set ${PRIVATE_KEY_PATH}.` },
  "no-key-older-host": {
    status: "degraded",
    message: `This PI WEB does not pass private settings to plugins, so ${PRIVATE_KEY_PATH} cannot be read. Upgrade PI WEB.`,
  },
};

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Voice",
  activate: (context) => {
    const service = createAzureSpeechTokenService();
    const source = resolveAzureSpeechKey(context.settings, context.serverSettings);
    const health = KEY_SOURCE_HEALTH[source.kind];
    return {
      operations: {
        "speech.token": async (): Promise<JsonValue> => {
          if (!("config" in source)) return { configured: false, reason: health.message ?? "Azure Speech is not configured on this machine." };
          const token = await service.issue(source.config);
          return { configured: true, token, region: source.config.region, expiresInSeconds: 540 };
        },
      },
      health: () => health,
    };
  },
};

export default plugin;
