import type { JsonValue, PiWebServerPlugin } from "@gang-of-beads/pi-web/server-plugin-api";
import { withAnsweredVersion } from "./piWebUpdateOffer.js";

/**
 * Updates' server half: which PI WEB versions this machine has been offered.
 *
 * The record is machine-owned, in the plugin's own storage, so the offer is
 * one popup per version however many browsers open the machine - and closing
 * the popup on a phone settles it for the desktop too.
 */
const ANSWERED_KEY = "answeredVersions";

function answeredFrom(stored: JsonValue | undefined): string[] {
  return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === "string") : [];
}

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Updates",
  activate: (context) => ({
    operations: {
      "offer.answered": async (): Promise<JsonValue> => ({ answeredVersions: answeredFrom(await context.storage.read(ANSWERED_KEY)) }),
      "offer.answer": async (input): Promise<JsonValue> => {
        const version: unknown = typeof input === "object" && input !== null ? Reflect.get(input, "version") : undefined;
        if (typeof version !== "string" || version === "") return { recorded: false, reason: "no-version" };
        const answered = withAnsweredVersion(answeredFrom(await context.storage.read(ANSWERED_KEY)), version);
        await context.storage.write(ANSWERED_KEY, answered);
        return { recorded: true, answeredVersions: answered };
      },
    },
  }),
};

export default plugin;
