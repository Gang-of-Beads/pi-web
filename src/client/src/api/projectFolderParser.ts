import { requireNumber, requireRecord, requireString } from "./parsers";
import type { ProjectFolderContents, ProjectFolderCrumb, ProjectFolderEntry, ProjectFolderListing, ProjectFolderUnreadableCause } from "../../../shared/apiTypes";

/** The machine's answer for one folder of the add-project folder browser, checked field by field. */
export function parseProjectFolderListing(value: unknown): ProjectFolderListing {
  const record = requireRecord(value);
  const parent = record["parent"];
  if (parent !== null && typeof parent !== "string") throw new Error("Expected string or null field: parent");
  return {
    path: requireString(record, "path"),
    parent,
    crumbs: requireArray(record, "crumbs").map(parseNamedPath),
    separator: requireString(record, "separator"),
    contents: parseContents(requireRecord(record["contents"])),
  };
}

const UNREADABLE_CAUSES: readonly ProjectFolderUnreadableCause[] = ["not-a-folder", "denied", "timed-out", "failed"];

const CONTENTS_PARSERS: Readonly<Record<ProjectFolderContents["kind"], (record: Record<string, unknown>) => ProjectFolderContents>> = {
  complete: (record) => ({ kind: "complete", folders: folders(record) }),
  truncated: (record) => ({ kind: "truncated", folders: folders(record), total: requireNumber(record, "total") }),
  incomplete: (record) => ({ kind: "incomplete", folders: folders(record) }),
  missing: () => ({ kind: "missing" }),
  unreadable: (record) => {
    const cause = UNREADABLE_CAUSES.find((candidate) => candidate === record["cause"]);
    if (cause === undefined) throw new Error("Invalid unreadable folder cause");
    const detail = record["detail"];
    return typeof detail === "string" ? { kind: "unreadable", cause, detail } : { kind: "unreadable", cause };
  },
};

function parseContents(record: Record<string, unknown>): ProjectFolderContents {
  const kind = requireString(record, "kind");
  const parse = Object.entries(CONTENTS_PARSERS).find(([candidate]) => candidate === kind)?.[1];
  if (parse === undefined) throw new Error("Invalid folder contents kind");
  return parse(record);
}

function folders(record: Record<string, unknown>): ProjectFolderEntry[] {
  return requireArray(record, "folders").map(parseNamedPath);
}

function parseNamedPath(value: unknown): ProjectFolderCrumb & ProjectFolderEntry {
  const record = requireRecord(value);
  return { name: requireString(record, "name"), path: requireString(record, "path") };
}

function requireArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`Expected array field: ${key}`);
  return value;
}
