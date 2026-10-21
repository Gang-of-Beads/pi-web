import { browserLocalStorage } from "./browserLocalStorage";
import type { InstallPromptOutcome } from "./installPromptCapture";

/**
 * The "install PI WEB as an app" offer on touch devices (owner, 2026-10-21): which offer a page
 * shows, decided in one place, so the dialog only draws what this module names.
 *
 * Absence is not negation here: a Chromium page that has not received `beforeinstallprompt` yet may
 * still get it, so the offer falls back to the browser-menu steps and switches to Install when the
 * event arrives, rather than concluding that installing is impossible.
 */
export type InstallHintState =
  | "hidden-installed"
  | "hidden-no-touch"
  | "hidden-dismissed"
  | "hidden-later"
  | "needs-https"
  | "ios-steps-http"
  | "install-prompt"
  | "ios-steps"
  | "menu-steps";

export type IosDevice = "iphone" | "ipad";
/** Safari 26 is split out because its compact toolbar may keep Share behind the "⋯" button. */
export type IosBrowser = "safari" | "safari-26" | "chrome" | "other";
export type InstallPlatform = { readonly kind: "ios"; readonly device: IosDevice; readonly browser: IosBrowser } | { readonly kind: "other" };

/** Where the browser's own Share button probably sits; the page cannot see the toolbar, so this is a guess. */
export type ShareButtonGuess = "bottom-center" | "bottom-right" | "top-right" | "unknown";

/**
 * The best guess per device and browser class, as docs/install.md ("The install offer") describes it.
 * The steps text is written to be right where this guess is wrong.
 */
export const SHARE_BUTTON_GUESS: Readonly<Record<`${IosDevice}-${IosBrowser}`, ShareButtonGuess>> = {
  "iphone-safari": "bottom-center",
  "iphone-safari-26": "bottom-right",
  "iphone-chrome": "top-right",
  "iphone-other": "unknown",
  "ipad-safari": "top-right",
  "ipad-safari-26": "top-right",
  "ipad-chrome": "top-right",
  "ipad-other": "unknown",
};

/** One versioned record per browser: what the reader chose about the offer. */
export type InstallHintRecord =
  | { readonly version: 1; readonly choice: "later"; readonly at: number }
  | { readonly version: 1; readonly choice: "never" }
  | { readonly version: 1; readonly choice: "installed" };

export const INSTALL_HINT_STORAGE_KEY = "pi-web.installHint";
export const INSTALL_HINT_LATER_MS = 7 * 24 * 60 * 60 * 1000;

export interface InstallHintInputs {
  readonly runningInstalled: boolean;
  readonly touch: boolean;
  readonly secureContext: boolean;
  readonly platform: InstallPlatform;
  readonly promptAvailable: boolean;
  readonly record: InstallHintRecord | undefined;
  readonly now: number;
}

const RECORD_STATE: Readonly<Record<InstallHintRecord["choice"], InstallHintState>> = {
  later: "hidden-later",
  never: "hidden-dismissed",
  installed: "hidden-installed",
};

/**
 * A plain-HTTP page (owner, 2026-10-21): iPhone and iPad can still add it to the Home Screen, so they
 * get the Share steps with a word for HTTPS; elsewhere installing needs HTTPS.
 */
const INSECURE_STATE: Readonly<Record<InstallPlatform["kind"], InstallHintState>> = {
  ios: "ios-steps-http",
  other: "needs-https",
};

export function installHintState(inputs: InstallHintInputs): InstallHintState {
  if (inputs.runningInstalled) return "hidden-installed";
  if (!inputs.touch) return "hidden-no-touch";
  if (inputs.record !== undefined && !laterExpired(inputs.record, inputs.now)) return RECORD_STATE[inputs.record.choice];
  if (!inputs.secureContext) return INSECURE_STATE[inputs.platform.kind];
  if (inputs.promptAvailable) return "install-prompt";
  return inputs.platform.kind === "ios" ? "ios-steps" : "menu-steps";
}

function laterExpired(record: InstallHintRecord, now: number): boolean {
  return record.choice === "later" && now - record.at >= INSTALL_HINT_LATER_MS;
}

/**
 * What the system install prompt's answer leaves behind: accepted hides the offer for good, the prompt
 * dismissed counts as Later (owner, 2026-10-21), and a prompt that could not run records nothing.
 */
export function recordAfterPrompt(outcome: InstallPromptOutcome, now: number): InstallHintRecord | undefined {
  const records: Record<InstallPromptOutcome, InstallHintRecord | undefined> = {
    accepted: { version: 1, choice: "installed" },
    dismissed: { version: 1, choice: "later", at: now },
    unavailable: undefined,
  };
  return records[outcome];
}

/** The offer's one action, where it has one: the system prompt, or the HTTPS docs. */
export type InstallHintPrimary = "install" | "https-docs";
/** Which written steps the offer shows: the Share sheet on iOS, the browser menu elsewhere. */
export type InstallHintSteps = "ios-share" | "browser-menu";

export interface InstallHintWords {
  readonly message: string;
  readonly primary?: InstallHintPrimary;
  readonly steps?: InstallHintSteps;
  /** A sentence after the steps. */
  readonly note?: string;
}

const INSTALL_MESSAGE = "Install PI WEB on your Home Screen to use it full screen.";

export const INSTALL_HINT_WORDS: Readonly<Record<InstallHintState, InstallHintWords | undefined>> = {
  "hidden-installed": undefined,
  "hidden-no-touch": undefined,
  "hidden-dismissed": undefined,
  "hidden-later": undefined,
  "needs-https": { message: "Installing PI WEB as an app needs HTTPS.", primary: "https-docs" },
  "ios-steps-http": { message: INSTALL_MESSAGE, steps: "ios-share", primary: "https-docs", note: "PI WEB works better over HTTPS, which some features need." },
  "install-prompt": { message: INSTALL_MESSAGE, primary: "install" },
  "ios-steps": { message: INSTALL_MESSAGE, steps: "ios-share" },
  "menu-steps": { message: INSTALL_MESSAGE, steps: "browser-menu" },
};

/**
 * Whether the offer opens by itself now (owner, 2026-10-21: it pops up like the Updates offer). It
 * opens at most once per page load, only after the app has settled on a view, and never over another
 * dialog: while one is open it waits for the last one to close.
 */
export type InstallOfferMoment = "already-considered" | "not-settled" | "modal-open" | "nothing-to-offer" | "offer";

export interface InstallOfferMomentInputs {
  readonly considered: boolean;
  readonly settled: boolean;
  readonly modalOpen: boolean;
  readonly hintState: InstallHintState;
}

export function installOfferMoment(inputs: InstallOfferMomentInputs): InstallOfferMoment {
  if (inputs.considered) return "already-considered";
  if (!inputs.settled) return "not-settled";
  if (inputs.modalOpen) return "modal-open";
  return INSTALL_HINT_WORDS[inputs.hintState] === undefined ? "nothing-to-offer" : "offer";
}

export const INSTALL_HTTPS_DOCS_URL = "https://github.com/Gang-of-Beads/pi-web/blob/main/docs/install.md#remote-access";

/**
 * The device and browser class from the user agent. iPadOS Safari reports a desktop Mac, so a Mac
 * with more than one touch point is an iPad. Safari 26 froze the OS version in the user agent, so
 * its own `Version/` token is what tells it apart.
 */
export function classifyInstallPlatform(userAgent: string, maxTouchPoints: number): InstallPlatform {
  const device = iosDevice(userAgent, maxTouchPoints);
  return device === undefined ? { kind: "other" } : { kind: "ios", device, browser: iosBrowser(userAgent) };
}

function iosDevice(userAgent: string, maxTouchPoints: number): IosDevice | undefined {
  if (/iPhone|iPod/u.test(userAgent)) return "iphone";
  if (userAgent.includes("iPad") || (userAgent.includes("Macintosh") && maxTouchPoints > 1)) return "ipad";
  return undefined;
}

function iosBrowser(userAgent: string): IosBrowser {
  if (userAgent.includes("CriOS/")) return "chrome";
  if (/FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo/u.test(userAgent)) return "other";
  const safariVersion = /Version\/(\d+).*Safari\//u.exec(userAgent)?.[1];
  if (safariVersion === undefined) return "other";
  return Number(safariVersion) >= 26 ? "safari-26" : "safari";
}

export function shareButtonGuess(platform: InstallPlatform): ShareButtonGuess {
  return platform.kind === "ios" ? SHARE_BUTTON_GUESS[`${platform.device}-${platform.browser}`] : "unknown";
}

export function readInstallHintRecord(storage: Pick<Storage, "getItem"> | undefined = browserLocalStorage()): InstallHintRecord | undefined {
  try {
    const raw = storage?.getItem(INSTALL_HINT_STORAGE_KEY) ?? null;
    return raw === null ? undefined : parseInstallHintRecord(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/**
 * How lasting each choice is. A choice never replaces a more lasting one: two tabs can each hold an
 * open offer, so a Later closed in one must not undo Don't show again picked in the other, and an
 * install accepted after the offer closed as Later still replaces that Later.
 */
const CHOICE_PERMANENCE: Readonly<Record<InstallHintRecord["choice"], number>> = { later: 0, never: 1, installed: 2 };

/** The record to keep when `next` is chosen over what is `stored`. */
function lastingInstallHintRecord(stored: InstallHintRecord | undefined, next: InstallHintRecord): InstallHintRecord {
  return stored === undefined || CHOICE_PERMANENCE[next.choice] >= CHOICE_PERMANENCE[stored.choice] ? next : stored;
}

/** Records the reader's choice unless a more lasting one is already stored (`lastingInstallHintRecord`). */
export function rememberInstallHintChoice(record: InstallHintRecord, storage: Pick<Storage, "getItem" | "setItem"> | undefined = browserLocalStorage()): void {
  writeInstallHintRecord(lastingInstallHintRecord(readInstallHintRecord(storage), record), storage);
}

function writeInstallHintRecord(record: InstallHintRecord, storage: Pick<Storage, "setItem"> | undefined): void {
  try {
    storage?.setItem(INSTALL_HINT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable: the choice is dropped and the offer may return after a reload.
  }
}

function parseInstallHintRecord(value: unknown): InstallHintRecord | undefined {
  if (typeof value !== "object" || value === null || Reflect.get(value, "version") !== 1) return undefined;
  const choice: unknown = Reflect.get(value, "choice");
  const at: unknown = Reflect.get(value, "at");
  if (choice === "later") return typeof at === "number" && Number.isFinite(at) ? { version: 1, choice, at } : undefined;
  if (choice === "never" || choice === "installed") return { version: 1, choice };
  return undefined;
}
