import { branchFromFileEntries } from "./fileBranch.js";
import { readableMessageCount } from "./readableMessageCount.js";
import { endsWithClosingBrace, isRecord, tryParseEntry } from "./sessionFileFormat.js";

const MESSAGE_HEAD = Buffer.from('{"type":"message","id":"');
const ENTRY_HEAD = Buffer.from('{"type":"');
const ID_KEY = Buffer.from(',"id":"');
const PARENT_KEY = Buffer.from(',"parentId":');
const TIMESTAMP_KEY = Buffer.from(',"timestamp":"');
const ROLE_KEY = Buffer.from(',"message":{"role":"');
const CUSTOM_TYPE_KEY = Buffer.from(',"customType":"');
const STOP_REASON_KEY = Buffer.from(',"stopReason":"');
const NULL_LITERAL = Buffer.from("null");
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const CLOSING_BRACE = 0x7d;
const LINE_END_BYTES: ReadonlySet<number | undefined> = new Set([0x20, 0x09, 0x0d]);
const PI_WEB_RECORD_PREFIX = "pi-web.";

/** A value read off a line, and the offset just past it. */
interface Read<T> {
  readonly value: T;
  readonly next: number;
}

/** The fields the count reads off one entry: never a message body, a summary or extension data. */
type CountedEntry = Record<string, unknown>;

/**
 * Where pi 1.1.0's `SessionManager` writes what the count reads, by entry type. A compaction, a
 * branch summary and every bookkeeping entry lead with `type`, `id`, `parentId`; a custom entry
 * and a custom message put `customType` second and their ids last, after the data or content.
 * `parsed` lines are read whole: a context edit and a custom message are small and the count reads
 * more of them, and a message only gets here when it does not start the way pi writes one.
 */
type LineLayout = "custom" | "leading" | "parsed";

const LAYOUTS: ReadonlyMap<string, LineLayout> = new Map([
  ["message", "parsed"],
  ["custom", "custom"],
  ["context_edit", "parsed"],
  ["custom_message", "parsed"],
]);

const READERS: Readonly<Record<LineLayout, (line: Buffer, type: Read<string>) => CountedEntry | undefined>> = {
  custom: customEntry,
  leading: leadingEntry,
  parsed: () => undefined,
};

/**
 * One session file's count as the transcript counts it (owner, Q19 2026-10-10: the session list
 * and Go to say the number the conversation says, before and after opening). Lines go in one by
 * one after the header; the count is `readableMessageCount` over the branch the file loads as,
 * the rule an open session's status uses, so the two cannot disagree.
 *
 * It keeps only what that rule reads (`isReadableBranchEntry`, `retriedAttemptIds`,
 * `stopOutcomes`): every entry's type, id and parent, a message's role and stop reason, a context
 * edit's target and whether it replaced anything, a custom message's display flag, a custom
 * entry's type, and PI WEB's own `pi-web.*` records whole. A field that rule starts to read must
 * be kept here too. The bodies, where a large session's size is, are read from bytes and never
 * decoded; any line not written in pi's layout is parsed whole instead.
 *
 * Measured on the owner's store (2,915 sessions, 6.9 GB), against a JSON parse of every line: the
 * same count for every session. Parsing every non-message line had spent 267 of the 418 ms the
 * 905 MB session took, nearly all of it on large custom entries and compactions whose bodies the
 * count never reads. As built, a cold listing of the whole store takes 3.6 s against 2.1 s for the
 * count of every message line, and a re-read of that session 264 ms against 120 ms; a warm
 * listing still reads only the files whose size changed.
 */
export class ReadableCountFold {
  private readonly entries: CountedEntry[] = [];

  add(data: Buffer, start: number, end: number): void {
    const line = data.subarray(start, end);
    const entry = (endsWithClosingBrace(data, start, end) ? entryFromBytes(line) : undefined) ?? countedEntry(tryParseEntry(line.toString("utf8")));
    if (entry !== undefined) this.entries.push(entry);
  }

  count(): number {
    return readableMessageCount(branchFromFileEntries(this.entries));
  }
}

function entryFromBytes(line: Buffer): CountedEntry | undefined {
  if (after(line, 0, MESSAGE_HEAD) > 0) return messageEntry(line);
  const type = stringAt(line, after(line, 0, ENTRY_HEAD));
  if (type === undefined) return undefined;
  return READERS[LAYOUTS.get(type.value) ?? "leading"](line, type);
}

function leadingEntry(line: Buffer, type: Read<string>): CountedEntry | undefined {
  const ids = idsFrom(line, after(line, type.next, ID_KEY));
  return ids === undefined ? undefined : { type: type.value, id: ids.value.id, parentId: ids.value.parentId };
}

/** A message line as pi writes it: `type`, `id`, `parentId`, `timestamp`, then `message` with `role` first and `stopReason` after the content. */
function messageEntry(line: Buffer): CountedEntry | undefined {
  const ids = idsFrom(line, MESSAGE_HEAD.length);
  if (ids === undefined) return undefined;
  const role = stringAt(line, after(line, skipString(line, after(line, ids.next, TIMESTAMP_KEY)), ROLE_KEY));
  if (role === undefined) return undefined;
  const stopAt = role.value === "assistant" ? line.lastIndexOf(STOP_REASON_KEY) : -1;
  if (stopAt < role.next) return { type: "message", id: ids.value.id, parentId: ids.value.parentId, message: { role: role.value } };
  const stopReason = stringAt(line, stopAt + STOP_REASON_KEY.length);
  return stopReason === undefined ? undefined : { type: "message", id: ids.value.id, parentId: ids.value.parentId, message: { role: role.value, stopReason: stopReason.value } };
}

/** An extension's custom entry, read from its type and its trailing ids; PI WEB's own records carry what the count reads, so they are parsed. */
function customEntry(line: Buffer, type: Read<string>): CountedEntry | undefined {
  const customType = stringAt(line, after(line, type.next, CUSTOM_TYPE_KEY));
  if (customType === undefined || isPiWebRecord(customType.value)) return undefined;
  const id = stringAt(line, after(line, line.lastIndexOf(ID_KEY), ID_KEY));
  const parent = id === undefined ? undefined : parentAt(line, after(line, id.next, PARENT_KEY));
  const end = parent === undefined ? -1 : skipString(line, after(line, parent.next, TIMESTAMP_KEY));
  if (id === undefined || parent === undefined || !closesLine(line, end)) return undefined;
  return { type: type.value, customType: customType.value, id: id.value, parentId: parent.value };
}

/** The id that starts at `from`, just past its opening quote, and the parent written right after it. */
function idsFrom(line: Buffer, from: number): Read<{ id: string; parentId: string | null }> | undefined {
  const id = stringAt(line, from);
  const parent = id === undefined ? undefined : parentAt(line, after(line, id.next, PARENT_KEY));
  return id === undefined || parent === undefined ? undefined : { value: { id: id.value, parentId: parent.value }, next: parent.next };
}

function parentAt(line: Buffer, at: number): Read<string | null> | undefined {
  if (at < 0) return undefined;
  if (line[at] === QUOTE) return stringAt(line, at + 1);
  const end = after(line, at, NULL_LITERAL);
  return end < 0 ? undefined : { value: null, next: end };
}

/** The offset just past `literal` when it sits at `at`, else -1. */
function after(line: Buffer, at: number, literal: Buffer): number {
  if (at < 0 || at + literal.length > line.length || literal.compare(line, at, at + literal.length) !== 0) return -1;
  return at + literal.length;
}

/** The JSON string that starts at `from`, just past its opening quote; undefined when it holds an escape, which only a parse reads right. */
function stringAt(line: Buffer, from: number): Read<string> | undefined {
  const close = closingQuote(line, from);
  return close < 0 ? undefined : { value: line.toString("utf8", from, close), next: close + 1 };
}

/** The offset just past the string that starts at `from`, without decoding it, or -1. */
function skipString(line: Buffer, from: number): number {
  const close = closingQuote(line, from);
  return close < 0 ? -1 : close + 1;
}

function closingQuote(line: Buffer, from: number): number {
  if (from < 0) return -1;
  const close = line.indexOf(QUOTE, from);
  if (close < 0) return -1;
  for (let index = from; index < close; index += 1) {
    if (line[index] === BACKSLASH) return -1;
  }
  return close;
}

function closesLine(line: Buffer, at: number): boolean {
  if (at < 0 || line[at] !== CLOSING_BRACE) return false;
  for (let index = at + 1; index < line.length; index += 1) {
    if (!LINE_END_BYTES.has(line[index])) return false;
  }
  return true;
}

/** A parsed entry with only the fields the count reads. */
function countedEntry(entry: Record<string, unknown> | undefined): CountedEntry | undefined {
  if (entry === undefined) return undefined;
  const message = entry["message"];
  return {
    type: entry["type"],
    id: entry["id"],
    parentId: entry["parentId"],
    ...(isRecord(message) ? { message: { role: message["role"], stopReason: message["stopReason"] } } : {}),
    ...(entry["type"] === "context_edit" ? { targetId: entry["targetId"], replacement: entry["replacement"] === null ? null : true } : {}),
    ...(entry["type"] === "custom_message" ? { display: entry["display"] } : {}),
    ...(entry["type"] === "custom" ? { customType: entry["customType"], ...(isPiWebRecord(entry["customType"]) ? { data: entry["data"] } : {}) } : {}),
  };
}

/** PI WEB's own custom records (`pi-web.*`): the only custom entries whose data the count reads. */
function isPiWebRecord(customType: unknown): boolean {
  return typeof customType === "string" && customType.startsWith(PI_WEB_RECORD_PREFIX);
}
