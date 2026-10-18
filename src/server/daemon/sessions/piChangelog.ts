/**
 * `/changelog`: pi's own CHANGELOG.md, shipped in the pi-coding-agent package the daemon runs, as markdown for the
 * command's row. Entries are read the way the SDK's `parseChangelog` reads them (`dist/utils/changelog.js`, not
 * exported): a `## [x.y.z]` heading starts an entry, newest first. The relative links in an entry point into pi's
 * repository; they are made absolute at the entry's tag, as `normalizeChangelogLinks` does, because in the page a
 * relative link would open a PI WEB path.
 */

const SHOWN_ENTRIES = 3;
const PI_REPOSITORY_BLOB_URL = "https://github.com/earendil-works/pi/blob";
const PI_PACKAGE_PATH = "packages/coding-agent/";
const VERSION_HEADING = /^##\s+\[?(\d+\.\d+\.\d+)\]?/u;
const INLINE_LINK = /(!?\[[^\]\n]+\]\()([^\s)]+)((?:\s+[^)]*)?\))/gu;
const ABSOLUTE_TARGET = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/iu;

interface ChangelogEntry {
  version: string;
  content: string;
}

export function piChangelogMarkdown(changelog: string): string {
  const entries = changelogEntries(changelog);
  if (entries.length === 0) return "No changelog entries found.";
  const shown = entries.slice(0, SHOWN_ENTRIES).map((entry) => absoluteLinks(entry));
  const older = entries.length - shown.length;
  return older === 0 ? shown.join("\n\n") : [...shown, `${String(older)} older ${older === 1 ? "entry is" : "entries are"} in pi's CHANGELOG.md.`].join("\n\n");
}

function changelogEntries(changelog: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: { version: string; lines: string[] } | undefined;
  const close = () => {
    if (current !== undefined) entries.push({ version: current.version, content: current.lines.join("\n").trim() });
  };
  for (const line of changelog.split("\n")) {
    if (!line.startsWith("## ")) {
      current?.lines.push(line);
      continue;
    }
    close();
    const version = VERSION_HEADING.exec(line)?.[1];
    current = version === undefined ? undefined : { version, lines: [line] };
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
  return entry.content.replace(INLINE_LINK, (_match, prefix: string, target: string, suffix: string) => `${prefix}${absolute(target)}${suffix}`);
}
