import { browserInstallHintState, showInstallAppOffer } from "./components/InstallAppOffer";
import { installOfferMoment, rememberInstallHintChoice, type InstallOfferMoment } from "./installHint";
import { installPromptCapture } from "./installPromptCapture";
import type { PluginDialog, PluginDialogHandle } from "./plugins/types";

export interface InstallAppOfferPorts {
  readonly runningInstalled: () => boolean;
  readonly modalOpen: () => boolean;
  readonly showDialog: (dialog: PluginDialog) => PluginDialogHandle;
}

/**
 * When the install offer opens by itself (`installOfferMoment`). The app tells it when it has
 * settled on a view and whenever a dialog opens or closes. It also records the browser's
 * `appinstalled` answer whether or not an offer is open, so an install from the browser menu is remembered.
 * Each moment is weighed on the next animation frame rather than at once: a dialog whose state was set
 * in the same task has not rendered yet, and the offer must not open underneath it.
 */
export class InstallAppOfferGate {
  private settled = false;
  private considered = false;
  private pendingFrame: number | undefined;

  constructor(private readonly ports: InstallAppOfferPorts) {}

  watch(): () => void {
    const unsubscribe = installPromptCapture.subscribe(this.onCaptureChange);
    return () => {
      unsubscribe();
      if (this.pendingFrame !== undefined) cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = undefined;
    };
  }

  noteSettled(): void {
    this.settled = true;
    this.consider();
  }

  noteModalChange(): void {
    this.consider();
  }

  private readonly onMoment: Readonly<Record<InstallOfferMoment, () => void>> = {
    "already-considered": () => undefined,
    "not-settled": () => undefined,
    "modal-open": () => undefined,
    "nothing-to-offer": () => { this.considered = true; },
    offer: () => {
      this.considered = true;
      showInstallAppOffer(this.ports, this.ports.runningInstalled());
    },
  };

  private consider(): void {
    if (this.pendingFrame !== undefined) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = undefined;
      this.weighMoment();
    });
  }

  private weighMoment(): void {
    this.onMoment[installOfferMoment({
      considered: this.considered,
      settled: this.settled,
      modalOpen: this.ports.modalOpen(),
      hintState: browserInstallHintState(this.ports.runningInstalled()),
    })]();
  }

  private readonly onCaptureChange = (): void => {
    if (installPromptCapture.appInstalled) rememberInstallHintChoice({ version: 1, choice: "installed" });
  };
}
