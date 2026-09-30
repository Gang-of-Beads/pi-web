import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Which top-level entries of docs/ the site publishes.
 *
 * Production serves docs/ directly and Cloudflare honours docs/.assetsignore; the dev deploy
 * copies entries into a staging directory. Both read the one list in .assetsignore, so an
 * internal note cannot be private on one deploy and public on the other. The matcher covers
 * the three forms that file uses: `name/` for a directory, `*.ext`, and `!name` to keep one.
 */
export function readSiteIgnore(docsDir) {
  return readFileSync(path.join(docsDir, ".assetsignore"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function matches(pattern, name, isDirectory) {
  if (pattern.endsWith("/")) return isDirectory && name === pattern.slice(0, -1);
  if (pattern.startsWith("*.")) return !isDirectory && name.endsWith(pattern.slice(1));
  return name === pattern;
}

export function isPublishedEntry(name, isDirectory, patterns) {
  if (name.startsWith(".")) return false;
  let published = true;
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      if (matches(pattern.slice(1), name, isDirectory)) published = true;
    } else if (matches(pattern, name, isDirectory)) {
      published = false;
    }
  }
  return published;
}
