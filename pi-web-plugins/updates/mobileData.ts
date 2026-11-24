/**
 * Whether an update may download on a metered connection.
 *
 * A phone on mobile data is the case this exists for: a PI WEB update pulls a
 * package (and its dependencies) down, which is the reader's traffic. The
 * choice is a browser preference, not a machine setting, so it follows the
 * device that will download and lives in its localStorage; the Updates page is
 * where it is edited.
 */
export type MobileDataChoice = "ask" | "auto" | "never";

export const MOBILE_DATA_STORAGE_KEY = "pi-web.updates.mobile-data";

/** Default: nothing downloads on mobile data without a word. */
export const DEFAULT_MOBILE_DATA_CHOICE: MobileDataChoice = "ask";

export interface ChoiceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isChoice(value: unknown): value is MobileDataChoice {
  return value === "ask" || value === "auto" || value === "never";
}

export function readMobileDataChoice(storage: ChoiceStorage | undefined): MobileDataChoice {
  try {
    const stored = storage?.getItem(MOBILE_DATA_STORAGE_KEY);
    return isChoice(stored) ? stored : DEFAULT_MOBILE_DATA_CHOICE;
  } catch {
    return DEFAULT_MOBILE_DATA_CHOICE;
  }
}

export function writeMobileDataChoice(storage: ChoiceStorage | undefined, choice: MobileDataChoice): void {
  try {
    storage?.setItem(MOBILE_DATA_STORAGE_KEY, choice);
  } catch {
    // A full or blocked localStorage keeps the choice for this page only; the caller re-renders.
  }
}

/** The parts of `navigator.connection` this needs; absent on browsers without the API. */
export interface ConnectionLike {
  readonly type?: string;
  readonly effectiveType?: string;
  readonly saveData?: boolean;
}

/**
 * A cellular connection. `type` is only filled in by Chromium (this page's
 * target); where it is missing, `effectiveType` still arrives on a slow link
 * and is treated as mobile too, which errs towards asking.
 */
export function isMeteredConnection(connection: ConnectionLike | undefined): boolean {
  if (connection?.type !== undefined) return connection.type === "cellular";
  const effective = connection?.effectiveType;
  return effective === "slow-2g" || effective === "2g" || effective === "3g";
}

/**
 * What an update button does on the connection it is drawn on: run, ask first,
 * or warn only. `never` still offers the button; it just says where the traffic goes.
 */
export type UpdateGate = "direct" | "ask" | "warn";

export function updateGate(choice: MobileDataChoice, metered: boolean): UpdateGate {
  if (!metered) return "direct";
  if (choice === "auto") return "direct";
  return choice === "never" ? "warn" : "ask";
}

export const MOBILE_DATA_LABEL: Readonly<Record<MobileDataChoice, string>> = {
  ask: "Ask first",
  auto: "Download automatically",
  never: "Only on Wi-Fi",
};

export const MOBILE_DATA_WORDS: Readonly<Record<MobileDataChoice, string>> = {
  ask: "Updates ask before downloading on mobile data.",
  auto: "Updates download without asking on mobile data.",
  never: "Updates wait for Wi-Fi; the button still updates when you tap it.",
};
