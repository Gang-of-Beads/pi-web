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

/** The answered set after this machine settles one version, newest last. */
export function withAnsweredVersion(answered: readonly string[], version: string): string[] {
  return [...answered.filter((entry) => entry !== version), version].slice(-16);
}
