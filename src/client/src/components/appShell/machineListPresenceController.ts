import type { ReactiveController, ReactiveControllerHost } from "lit";
import { isForegroundModalContent, onModalPresenceChange } from "../modalLayerRegistry";

export type MachineListSurface = "navigation" | "overlay" | "settings";

export function foregroundMachineList(layers: { blockingPage: boolean; settings: boolean; navigationOverlay: boolean }): MachineListSurface | undefined {
  if (layers.blockingPage) return undefined;
  if (layers.settings) return "settings";
  return layers.navigationOverlay ? "overlay" : "navigation";
}

/** A foreground list owns probes only while its list rectangle and document are visible. */
export class MachineListPresenceController implements ReactiveController {
  private observer: IntersectionObserver | undefined;
  private stopModalPresence: (() => void) | undefined;
  private target: Element | undefined;
  private intersecting = false;
  private sent = false;
  private connected = false;

  constructor(private readonly host: ReactiveControllerHost & HTMLElement, private readonly listsMachines: () => boolean, private readonly changed: (visible: boolean) => void, private readonly listElement?: () => Element | undefined) {
    host.addController(this);
  }

  hostConnected(): void {
    this.connected = true;
    this.target = undefined;
    this.intersecting = false;
    this.stopModalPresence = onModalPresenceChange(this.refresh);
    this.host.ownerDocument.addEventListener("visibilitychange", this.refresh);
    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver((entries) => {
        if (this.observer !== observer) return;
        const entry = entries[entries.length - 1];
        if (entry === undefined) return;
        if (entry.target !== this.target) return;
        this.intersecting = entry.isIntersecting;
        this.refresh();
      });
      this.observer = observer;
    }
    this.hostUpdated();
  }

  hostUpdated(): void {
    const target = this.listElement === undefined ? this.host : this.listElement();
    if (target !== this.target) {
      this.observer?.disconnect();
      this.target = target;
      this.intersecting = false;
      if (target !== undefined) this.observer?.observe(target);
    }
    this.refresh();
  }

  hostDisconnected(): void {
    this.connected = false;
    this.stopModalPresence?.();
    this.stopModalPresence = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
    this.target = undefined;
    this.intersecting = false;
    this.host.ownerDocument.removeEventListener("visibilitychange", this.refresh);
    this.refresh();
  }

  private readonly refresh = (): void => {
    const target = this.target;
    const onScreen = this.observer === undefined ? target !== undefined && target.getClientRects().length > 0 && target.getBoundingClientRect().width > 0 && target.getBoundingClientRect().height > 0 : this.intersecting;
    const visible = this.connected && this.host.ownerDocument.visibilityState === "visible" && onScreen && this.listsMachines() && isForegroundModalContent(this.host);
    if (visible === this.sent) return;
    this.sent = visible;
    this.changed(visible);
  };
}
