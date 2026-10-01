/**
 * Whether this machine should be offered a PI WEB update, and who remembers
 * the answer.
 *
 * pi-web runs the pi agent it depends on, not the pi on the machine's PATH, so
 * updating PI WEB is what changes the agent a session runs: the offer is about
 * PI WEB. The answer belongs to the machine, so one popup settles a version
 * for every browser that opens it, and closing the popup answers it - a
 * dismissal that recorded nothing is what made the old pi offer return in
 * every session.
 */

export interface PiWebRelease {
  latestVersion?: string;
  updateAvailable?: boolean;
}

export type PiWebUpdateVerdict =
  | { kind: "none"; reason: "unknown-release" | "up-to-date" | "answered" }
  | { kind: "offer"; running: string; latest: string };

export function piWebUpdateOffer(input: {
  running: string | undefined;
  release: PiWebRelease | undefined;
  answeredVersions: readonly string[];
}): PiWebUpdateVerdict {
  const latest = input.release?.latestVersion;
  if (input.running === undefined || input.running === "" || latest === undefined || latest === "") {
    return { kind: "none", reason: "unknown-release" };
  }
  if (input.release?.updateAvailable !== true || latest === input.running) return { kind: "none", reason: "up-to-date" };
  if (input.answeredVersions.includes(latest)) return { kind: "none", reason: "answered" };
  return { kind: "offer", running: input.running, latest };
}

/** What the offer reads from a machine's `pi-web/status` answer. */
export interface PiWebStatusOfferFacts {
  running: string | undefined;
  release: PiWebRelease;
  command: string | undefined;
}

/**
 * The offer's facts from a `pi-web/status` answer. `running` is the web component's installed
 * version, else its runtime version: the version the server compares the latest release against
 * when it says `updateAvailable` (`src/server/shared/piWebStatus.ts`), and the one an update
 * moves from. While a restart is pending it is newer than the process that answers.
 * The status has no top-level `version`; reading one left `running` unknown on every machine, so
 * the offer stayed silent from the day it shipped (fd56eb53) until this fix.
 */
export function piWebOfferFacts(status: unknown): PiWebStatusOfferFacts {
  const record = recordAt(status);
  const release = recordAt(record["release"]);
  const web = recordAt(recordAt(record["components"])["web"]);
  const latestVersion = nonEmptyString(release["latestVersion"]);
  const updateAvailable = release["updateAvailable"];
  return {
    running: nonEmptyString(web["installedVersion"]) ?? nonEmptyString(web["runtimeVersion"]),
    release: {
      ...(latestVersion === undefined ? {} : { latestVersion }),
      ...(typeof updateAvailable === "boolean" ? { updateAvailable } : {}),
    },
    command: nonEmptyString(recordAt(record["commands"])["update"]),
  };
}

/** The versions this machine has already answered, from its `offer.answered` operation. */
export function answeredVersionsFrom(answer: unknown): string[] {
  const versions = recordAt(answer)["answeredVersions"];
  return Array.isArray(versions) ? versions.filter((entry): entry is string => typeof entry === "string") : [];
}

function recordAt(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The answered set after this machine settles one version, newest last. */
export function withAnsweredVersion(answered: readonly string[], version: string): string[] {
  return [...answered.filter((entry) => entry !== version), version].slice(-16);
}
