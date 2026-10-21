/**
 * Chromium's deferred install prompt (`beforeinstallprompt`), which lib.dom does not declare.
 * `userChoice` is read as unknown: it is the browser's answer, checked before it is believed.
 */
interface DeferredInstallPrompt {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<unknown>;
}

export type InstallPromptOutcome = "accepted" | "dismissed" | "unavailable";

function isDeferredInstallPrompt(event: Event): event is Event & DeferredInstallPrompt {
  return "prompt" in event && typeof event.prompt === "function" && "userChoice" in event && event.userChoice instanceof Promise;
}

function acceptedChoice(choice: unknown): boolean {
  return typeof choice === "object" && choice !== null && Reflect.get(choice, "outcome") === "accepted";
}

/**
 * Keeps the install event from the moment the page boots. Chromium fires `beforeinstallprompt` once
 * the page qualifies, which can be before the install offer opens, so the capture starts in the
 * entry module and the offer reads it when it opens.
 * The event is single-use: after `prompt()` it is dropped until the browser fires a new one.
 */
export class InstallPromptCapture {
  private deferred: DeferredInstallPrompt | undefined;
  private installed = false;
  private readonly listeners = new Set<() => void>();

  start(target: Pick<Window, "addEventListener">): void {
    target.addEventListener("beforeinstallprompt", this.onBeforeInstallPrompt);
    target.addEventListener("appinstalled", this.onAppInstalled);
  }

  get promptAvailable(): boolean {
    return this.deferred !== undefined;
  }

  get appInstalled(): boolean {
    return this.installed;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async prompt(): Promise<InstallPromptOutcome> {
    const deferred = this.deferred;
    if (deferred === undefined) return "unavailable";
    this.deferred = undefined;
    this.notify();
    try {
      await deferred.prompt();
      return acceptedChoice(await deferred.userChoice) ? "accepted" : "dismissed";
    } catch {
      return "unavailable";
    }
  }

  private readonly onBeforeInstallPrompt = (event: Event): void => {
    if (!isDeferredInstallPrompt(event)) return;
    event.preventDefault();
    this.deferred = event;
    this.notify();
  };

  private readonly onAppInstalled = (): void => {
    this.installed = true;
    this.deferred = undefined;
    this.notify();
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const installPromptCapture = new InstallPromptCapture();
