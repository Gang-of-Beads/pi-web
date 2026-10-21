import type { JsonValue, PiWebServerPlugin } from "@gang-of-beads/pi-web/server-plugin-api";
import { withAnsweredVersion } from "./piWebUpdateOffer.js";
import { withAnsweredPairs } from "./updatesOffer.js";

/**
 * Updates' server half: what this machine remembers about its "Updates on <machine>" pop-up.
 *
 * The record is machine-owned, in the plugin's own storage, so the offer is one popup per version
 * however many browsers open the machine - and an answer on a phone settles it for the desktop too.
 * It holds the answered PI WEB versions, the answered pi package `source@version` pairs, whether
 * package lines are offered (absent means on), and when a "remind me later" is due.
 */
const ANSWERED_KEY = "answeredVersions";
const ANSWERED_PACKAGES_KEY = "answeredPackages";
const PACKAGES_ENABLED_KEY = "packagesEnabled";
const REMIND_AFTER_KEY = "remindAfter";

function stringsFrom(stored: unknown): string[] {
  return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === "string") : [];
}

function field(input: unknown, key: string): unknown {
  return typeof input === "object" && input !== null ? Reflect.get(input, key) : undefined;
}

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Updates",
  activate: (context) => ({
    operations: {
      "offer.read": async (): Promise<JsonValue> => {
        const [answeredVersions, answeredPackages, packagesEnabled, remindAfter] = await Promise.all([
          context.storage.read(ANSWERED_KEY),
          context.storage.read(ANSWERED_PACKAGES_KEY),
          context.storage.read(PACKAGES_ENABLED_KEY),
          context.storage.read(REMIND_AFTER_KEY),
        ]);
        return {
          answeredVersions: stringsFrom(answeredVersions),
          answeredPackages: stringsFrom(answeredPackages),
          packagesEnabled: packagesEnabled !== false,
          ...(typeof remindAfter === "string" ? { remindAfter } : {}),
        };
      },
      "offer.answered": async (): Promise<JsonValue> => ({ answeredVersions: stringsFrom(await context.storage.read(ANSWERED_KEY)) }),
      "offer.answer": async (input): Promise<JsonValue> => {
        const version = field(input, "version");
        if (typeof version !== "string" || version === "") return { recorded: false, reason: "no-version" };
        const answered = withAnsweredVersion(stringsFrom(await context.storage.read(ANSWERED_KEY)), version);
        await context.storage.write(ANSWERED_KEY, answered);
        return { recorded: true, answeredVersions: answered };
      },
      "offer.answer-packages": async (input): Promise<JsonValue> => {
        const pairs = stringsFrom(field(input, "pairs")).filter((pair) => pair !== "");
        if (pairs.length === 0) return { recorded: false, reason: "no-pairs" };
        const answered = withAnsweredPairs(stringsFrom(await context.storage.read(ANSWERED_PACKAGES_KEY)), pairs);
        await context.storage.write(ANSWERED_PACKAGES_KEY, answered);
        return { recorded: true, answeredPackages: answered };
      },
      "offer.remind-later": async (input): Promise<JsonValue> => {
        const until = field(input, "until");
        if (typeof until !== "string" || Number.isNaN(Date.parse(until))) return { recorded: false, reason: "no-time" };
        await context.storage.write(REMIND_AFTER_KEY, until);
        return { recorded: true, remindAfter: until };
      },
      "offer.set-packages-enabled": async (input): Promise<JsonValue> => {
        const enabled = field(input, "enabled");
        if (typeof enabled !== "boolean") return { recorded: false, reason: "no-choice" };
        await context.storage.write(PACKAGES_ENABLED_KEY, enabled);
        return { recorded: true, packagesEnabled: enabled };
      },
    },
  }),
};

export default plugin;
