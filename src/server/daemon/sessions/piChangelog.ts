/**
 * `/changelog`: pi's own CHANGELOG.md, shipped in the pi-coding-agent package the daemon runs, as markdown for the
 * command's row. Entries are read the way the SDK's `parseChangelog` reads them (`dist/utils/changelog.js`, not
 * exported): a `## [x.y.z]` heading starts an entry, newest first. The relative links in an entry point into pi's
 * repository; they are made absolute at the entry's tag, as `normalizeChangelogLinks` does, because in the page a
 * relative link would open a PI WEB path. The answer is the whole markdown, for a browser that draws it flat, and the
 * same entries folded, one section per version under its heading, so the browser need not parse markdown to fold it.
 */

import type { FoldedMarkdown } from "../../../shared/apiTypes.js";

const SHOWN_ENTRIES = 3;
const PI_REPOSITORY_BLOB_URL = "https://github.com/earendil-works/pi/blob";
const PI_PACKAGE_PATH = "packages/coding-agent/";
const VERSION_HEADING = /^##\s+\[?(\d+\.\d+\.\d+)\]?(.*)$/u;
const INLINE_LINK = /(!?\[[^\]\n]+\]\()([^\s)]+)((?:\s+[^)]*)?\))/gu;
const ABSOLUTE_TARGET = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/iu;

interface ChangelogEntry {
  version: string;
  /** The heading as a reader names the version: "1.3.0 - 2026-10-15". */
  title: string;
  heading: string;
  body: string;
}

export interface PiChangelogAnswer {
  message: string;
  folded?: FoldedMarkdown;
}

export function piChangelogAnswer(changelog: string): PiChangelogAnswer {
  const entries = changelogEntries(changelog);
  if (entries.length === 0) return { message: "No changelog entries found." };
  const shown = entries.slice(0, SHOWN_ENTRIES).map((entry) => ({ title: entry.title, heading: entry.heading, markdown: absoluteLinks(entry) }));
  const older = entries.length - shown.length;
  const footer = older === 0 ? undefined : `${String(older)} older ${older === 1 ? "entry is" : "entries are"} in pi's CHANGELOG.md.`;
  const flat = shown.map((entry) => [entry.heading, entry.markdown].filter((part) => part !== "").join("\n\n"));
  return {
    message: (footer === undefined ? flat : [...flat, footer]).join("\n\n"),
    folded: { sections: shown.map((entry) => ({ title: entry.title, markdown: entry.markdown })), ...(footer === undefined ? {} : { footer }) },
  };
}

function changelogEntries(changelog: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: { version: string; title: string; heading: string; lines: string[] } | undefined;
  const close = () => {
    if (current !== undefined) entries.push({ version: current.version, title: current.title, heading: current.heading, body: current.lines.join("\n").trim() });
  };
  for (const line of changelog.split("\n")) {
    if (!line.startsWith("## ")) {
      current?.lines.push(line);
      continue;
    }
    close();
    const heading = VERSION_HEADING.exec(line.trimEnd());
    const version = heading?.[1];
    current = version === undefined ? undefined : { version, title: [version, heading?.[2]?.trim() ?? ""].filter((part) => part !== "").join(" "), heading: line.trim(), lines: [] };
  }
  close();
  return entries;
}

function absoluteLinks(entry: ChangelogEntry): string {
  const repositoryRoot = `${PI_REPOSITORY_BLOB_URL}/v${entry.version}/`;
  const packageRoot = `${repositoryRoot}${PI_PACKAGE_PATH}`;
  const absolute = (target: string): string => {
    if (ABSOLUTE_TARGET.test(target)) return target;
    return target.startsWith("/") ? new URL(target.slice(1), repositoryRoot).href : new URL(target, packageRoot).href;
  };
  return entry.body.replace(INLINE_LINK, (_match, prefix: string, target: string, suffix: string) => `${prefix}${absolute(target)}${suffix}`);
}
