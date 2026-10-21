import type { PiWebStatusResponse } from "@gang-of-beads/pi-web/plugin-api";
import type { PiWebUpdateVerdict } from "./piWebUpdateOffer.js";

/**
 * Whether a machine's "Updates on <machine>" pop-up opens, what it lists, and what each answer
 * records (owner, 2026-10-21).
 *
 * One dialog carries PI WEB's own update and the pi package updates. The machine remembers, in the
 * plugin's storage, which PI WEB versions and which `source@version` pairs were answered, whether
 * the package lines are offered at all (the page's switch, on unless turned off), and until when
 * the reader asked to be reminded later. A newer version is a new pair, so it is offered again.
 */

export type PiPackageUpdateFact = NonNullable<PiWebStatusResponse["piPackages"]>["packages"][number];

/** What the machine remembers about the pop-up, from its `offer.read` operation. */
export interface UpdatesOfferMemory {
  readonly answeredVersions: readonly string[];
  readonly answeredPackages: readonly string[];
  readonly packagesEnabled: boolean;
  /** Epoch milliseconds before which the pop-up stays closed. */
  readonly remindAfter?: number;
}

export function updatesOfferMemoryFrom(answer: unknown): UpdatesOfferMemory {
  const record = recordAt(answer);
  const remindAfter = typeof record["remindAfter"] === "string" ? Date.parse(record["remindAfter"]) : Number.NaN;
  return {
    answeredVersions: stringsAt(record["answeredVersions"]),
    answeredPackages: stringsAt(record["answeredPackages"]),
    packagesEnabled: record["packagesEnabled"] !== false,
    ...(Number.isNaN(remindAfter) ? {} : { remindAfter }),
  };
}

/**
 * The memory a machine whose session daemon predates `offer.read` can give: its `offer.answered`
 * versions. Its package answers cannot be read, so no package line is offered (it would return
 * after every answer), while the PI WEB line keeps working as it did before.
 */
export function piWebOnlyOfferMemory(answeredVersions: readonly string[]): UpdatesOfferMemory {
  return { answeredVersions, answeredPackages: [], packagesEnabled: false };
}

/** The pair a package answer is remembered by: one version of one source. */
export const packagePair = (update: PiPackageUpdateFact): string => `${update.source}@${update.available ?? ""}`;

export interface UpdatesOfferLines {
  readonly piWeb: { readonly running: string; readonly latest: string } | undefined;
  readonly packages: readonly PiPackageUpdateFact[];
}

export type UpdatesOfferVerdict =
  | { readonly kind: "none"; readonly reason: "reminding-later" | "nothing-new" }
  | ({ readonly kind: "offer" } & UpdatesOfferLines);

export function updatesOffer(input: {
  readonly piWeb: PiWebUpdateVerdict;
  readonly piPackages: PiWebStatusResponse["piPackages"];
  readonly memory: UpdatesOfferMemory;
  readonly now: number;
}): UpdatesOfferVerdict {
  if (input.memory.remindAfter !== undefined && input.memory.remindAfter > input.now) return { kind: "none", reason: "reminding-later" };
  const piWeb = input.piWeb.kind === "offer" ? { running: input.piWeb.running, latest: input.piWeb.latest } : undefined;
  const answered = new Set(input.memory.answeredPackages);
  const packages = input.memory.packagesEnabled
    ? (input.piPackages?.packages ?? []).filter((update) => update.state === "newer" && update.available !== undefined && !answered.has(packagePair(update)))
    : [];
  if (piWeb === undefined && packages.length === 0) return { kind: "none", reason: "nothing-new" };
  return { kind: "offer", piWeb, packages };
}

export type RemindDelay = "hour" | "day" | "week";

export const REMIND_DELAYS: Readonly<Record<RemindDelay, { readonly label: string; readonly ms: number }>> = {
  hour: { label: "1 hour", ms: 60 * 60 * 1000 },
  day: { label: "1 day", ms: 24 * 60 * 60 * 1000 },
  week: { label: "1 week", ms: 7 * 24 * 60 * 60 * 1000 },
};

export const REMIND_DELAY_ORDER: readonly RemindDelay[] = ["hour", "day", "week"];

/** How the reader left the dialog: closed it without a choice, asked to be reminded after the delay they picked, or settled these versions. */
export type UpdatesOfferAnswer =
  | { readonly kind: "close" }
  | { readonly kind: "remind-later"; readonly delay: RemindDelay }
  | { readonly kind: "dont-remind" };

type OfferAnswerOf<K extends UpdatesOfferAnswer["kind"]> = Extract<UpdatesOfferAnswer, { readonly kind: K }>;

/** What one line records: the dialog returns after a delay, or this version is never offered again. */
export type OfferLineRecord = { readonly kind: "remind"; readonly delay: RemindDelay } | { readonly kind: "answer" };

export interface OfferAnswerRecords {
  readonly piWeb: OfferLineRecord;
  readonly packages: OfferLineRecord;
}

/**
 * Each answer's record, per line kind. Closing without a choice reminds after one day, for every
 * line (owner, 2026-10-21: it used to answer the PI WEB version); the `close` entry sets that rule
 * for both the PI WEB line and the package lines, so a change to it goes there.
 */
export const OFFER_ANSWER_RECORDS: { readonly [K in UpdatesOfferAnswer["kind"]]: (answer: OfferAnswerOf<K>) => OfferAnswerRecords } = {
  close: () => ({ piWeb: { kind: "remind", delay: "day" }, packages: { kind: "remind", delay: "day" } }),
  "remind-later": (answer) => ({ piWeb: { kind: "remind", delay: answer.delay }, packages: { kind: "remind", delay: answer.delay } }),
  "dont-remind": () => ({ piWeb: { kind: "answer" }, packages: { kind: "answer" } }),
};

/** The writes an answer makes for the lines the dialog offered: at most one reminder (the shortest asked), and the versions it settles. */
export interface OfferAnswerWrites {
  readonly remindAfter?: number;
  readonly piWebVersion?: string;
  readonly packagePairs: readonly string[];
}

export function offerAnswerWrites<K extends UpdatesOfferAnswer["kind"]>(lines: UpdatesOfferLines, answer: OfferAnswerOf<K>, now: number): OfferAnswerWrites {
  const records = OFFER_ANSWER_RECORDS[answer.kind](answer);
  const offered: readonly (readonly [OfferLineRecord, boolean])[] = [[records.piWeb, lines.piWeb !== undefined], [records.packages, lines.packages.length > 0]];
  const delays = offered.flatMap(([record, present]) => (present && record.kind === "remind" ? [REMIND_DELAYS[record.delay].ms] : []));
  return {
    ...(delays.length === 0 ? {} : { remindAfter: now + Math.min(...delays) }),
    ...(lines.piWeb !== undefined && records.piWeb.kind === "answer" ? { piWebVersion: lines.piWeb.latest } : {}),
    packagePairs: records.packages.kind === "answer" ? lines.packages.map(packagePair) : [],
  };
}

/** The answered pairs after this machine settles some, newest last, bounded so the record cannot grow without end. */
export function withAnsweredPairs(answered: readonly string[], pairs: readonly string[]): string[] {
  const settled = new Set(pairs);
  return [...answered.filter((entry) => !settled.has(entry)), ...settled].slice(-64);
}

type PiPackages = NonNullable<PiWebStatusResponse["piPackages"]>;

const LISTINGS: readonly PiPackages["listing"][] = ["listed", "skipped", "no-profile", "failed"];
const UPDATE_STATES: readonly PiPackageUpdateFact["state"][] = ["newer", "current", "checking", "pinned", "local", "missing", "failed"];
const SOURCE_KINDS: readonly PiPackageUpdateFact["kind"][] = ["npm", "git", "local"];
const SERVER_PROCESSES: readonly PiPackageUpdateFact["serverPluginProcesses"][number][] = ["web", "sessiond"];
const UNNAMED_PACKAGE = "Unnamed package";

/**
 * The package block of a `pi-web/status` answer. One that is not shaped like it, or whose listing
 * this page does not know (a reason a newer machine adds), is absent, never "no updates"; an entry
 * this page cannot read is kept by its name in `unreadable`, so the package still shows.
 */
export function piPackagesFrom(status: unknown): PiWebStatusResponse["piPackages"] {
  const block = recordAt(status)["piPackages"];
  if (typeof block !== "object" || block === null) return undefined;
  const record = recordAt(block);
  const listing = LISTINGS.find((candidate) => candidate === record["listing"]);
  if (listing === undefined || typeof record["checking"] !== "boolean" || !Array.isArray(record["packages"])) return undefined;
  const checkedAt = optionalString(record["checkedAt"]);
  const listingError = optionalString(record["listingError"]);
  const entries: unknown[] = record["packages"];
  const packages: PiPackageUpdateFact[] = [];
  const unreadable: string[] = [];
  for (const entry of entries) {
    const update = piPackageUpdateFrom(entry);
    if (update === undefined) unreadable.push(optionalString(recordAt(entry)["displayName"]) ?? UNNAMED_PACKAGE);
    else packages.push(update);
  }
  return {
    listing,
    ...(checkedAt === undefined ? {} : { checkedAt }),
    checking: record["checking"],
    ...(listingError === undefined ? {} : { listingError }),
    packages,
    ...(unreadable.length === 0 ? {} : { unreadable }),
  };
}

function piPackageUpdateFrom(value: unknown): PiPackageUpdateFact | undefined {
  const record = recordAt(value);
  const state = UPDATE_STATES.find((candidate) => candidate === record["state"]);
  const kind = SOURCE_KINDS.find((candidate) => candidate === record["kind"]);
  const source = optionalString(record["source"]);
  const displayName = optionalString(record["displayName"]);
  if (state === undefined || kind === undefined || source === undefined || displayName === undefined) return undefined;
  const installed = optionalString(record["installed"]);
  const available = optionalString(record["available"]);
  const error = optionalString(record["error"]);
  return {
    source,
    displayName,
    kind,
    ...(installed === undefined ? {} : { installed }),
    ...(available === undefined ? {} : { available }),
    state,
    ...(error === undefined ? {} : { error }),
    serverPluginProcesses: SERVER_PROCESSES.filter((name) => Array.isArray(record["serverPluginProcesses"]) && record["serverPluginProcesses"].includes(name)),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function recordAt(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
}

function stringsAt(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
