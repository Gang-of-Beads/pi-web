import type { JsonValue, PiWebServerPlugin } from "@gang-of-beads/pi-web/server-plugin-api";
import { createAzureSpeechTokenService, parseAzureSpeechSettings } from "./server/azureSpeechToken.js";

/**
 * Voice's server half.
 *
 * Live transcription connects from the page straight to the speech service,
 * because putting a server in the audio path adds a hop to every syllable for
 * nothing. The page therefore needs a credential - but not the subscription
 * key, which could be used for anything and would be readable by anyone who
 * opened the developer tools. The key stays here and the page gets a token
 * that expires.
 *
 * Unconfigured is a state, not a failure: the operation says the feature is
 * not configured rather than pretending to have minted something.
 */

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Voice",
  activate: (context) => {
    const service = createAzureSpeechTokenService();
    return {
      operations: {
        "speech.token": async (): Promise<JsonValue> => {
          const config = parseAzureSpeechSettings(context.settings);
          if (config === undefined) return { configured: false };
          const token = await service.issue(config);
          return { configured: true, token, region: config.region, expiresInSeconds: 540 };
        },
      },
    };
  },
};

export default plugin;
