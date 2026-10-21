import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  INSTALL_HINT_WORDS, INSTALL_HTTPS_DOCS_URL, classifyInstallPlatform, installHintState, readInstallHintRecord, recordAfterPrompt,
  rememberInstallHintChoice, shareButtonGuess, type InstallHintPrimary, type InstallHintRecord, type InstallHintState, type InstallHintSteps, type InstallHintWords, type ShareButtonGuess,
} from "../installHint";
import { installPromptCapture } from "../installPromptCapture";
import { touchPrimaryPointer } from "../keyboardDismissal";
import type { PluginDialog, PluginDialogHandle } from "../plugins/types";
import { barKeyStyles } from "./appShell/panelHeaderStyles";
import { interactiveSurfaceStyles } from "./shared";
import { renderCrossIcon, renderDownIcon, renderShareIcon, renderUpIcon, uiIconStyle } from "./uiIcons.js";

const OFFER_LABEL = "Install PI WEB";

const STEPS: Readonly<Record<InstallHintSteps, () => TemplateResult>> = {
  "ios-share": () => html`
    <li><span>Tap Share <span class="share-glyph">${renderShareIcon()}</span>. If it is not on the toolbar, tap <span aria-label="More">⋯</span> first.</span></li>
    <li><span>Tap Add to Home Screen (scroll down if you do not see it), then Add.</span></li>`,
  "browser-menu": () => html`
    <li><span>Open the browser menu (<span aria-label="More">⋮</span> or <span aria-label="Menu">☰</span>).</span></li>
    <li><span>Choose Install app or Add to Home screen.</span></li>`,
};

/** The pill's arrow points from the pill toward the guessed Share button; an unknown spot gets no pill. */
const SHARE_PILL_ARROW: Readonly<Record<ShareButtonGuess, (() => TemplateResult) | undefined>> = {
  "bottom-center": renderDownIcon,
  "bottom-right": renderDownIcon,
  "top-right": renderUpIcon,
  unknown: undefined,
};

function renderSharePill(guess: ShareButtonGuess): TemplateResult | typeof nothing {
  const arrow = SHARE_PILL_ARROW[guess];
  return arrow === undefined ? nothing : html`<div class="share-pill ${guess}" aria-hidden="true">${renderShareIcon()} Share ${arrow()}</div>`;
}

function laterRecord(): InstallHintRecord {
  return { version: 1, choice: "later", at: Date.now() };
}

/** What this browser, on this page, would offer: the classifier fed with the live inputs. */
export function browserInstallHintState(runningInstalled: boolean, promptAvailable: boolean = installPromptCapture.promptAvailable): InstallHintState {
  return installHintState({
    runningInstalled,
    touch: touchPrimaryPointer(),
    secureContext: window.isSecureContext,
    platform: classifyInstallPlatform(navigator.userAgent, navigator.maxTouchPoints),
    promptAvailable,
    record: readInstallHintRecord(),
    now: Date.now(),
  });
}

/**
 * Opens the install offer on the app's dialog surface, the one the Updates offer uses. Every close
 * answers it: the dialog's own keys record their choice, and ×, Escape, the backdrop or the back
 * gesture count as Later (owner, 2026-10-21). An answer that arrives after the dialog closed is still
 * recorded: the system install prompt can outlive a close, and its "accepted" replaces that Later.
 */
export function showInstallAppOffer(host: { showDialog(dialog: PluginDialog): PluginDialogHandle }, runningInstalled: boolean): void {
  let answered = false;
  const answer = (record: InstallHintRecord | undefined): void => {
    if (record !== undefined) rememberInstallHintChoice(record);
    if (answered) return;
    answered = true;
    handle.close();
  };
  const handle = host.showDialog({
    label: OFFER_LABEL,
    onClose: () => { if (!answered) answer(laterRecord()); },
    content: html`<install-app-offer .runningInstalled=${runningInstalled} .onAnswer=${answer}></install-app-offer>`,
  });
}

/**
 * The install offer's content (owner, 2026-10-21: it pops up like the Updates offer instead of
 * sitting in the chat as a banner). Which offer shows is `installHintState`'s decision; this element
 * draws it and reports the reader's answer. On iPhone and iPad a "Share" pill sits above the
 * backdrop where the browser's Share button probably is. When the live state stops offering anything
 * while the dialog is open (another tab recorded a choice), the dialog closes rather than stand empty.
 */
@customElement("install-app-offer")
export class InstallAppOffer extends LitElement {
  @property({ type: Boolean, attribute: false }) runningInstalled = false;
  /** The reader's answer; `undefined` closes without recording (the install happened elsewhere). */
  @property({ attribute: false }) onAnswer?: (record: InstallHintRecord | undefined) => void;

  @state() private prompting = false;
  private words: InstallHintWords | undefined;
  private unsubscribe: (() => void) | undefined;

  static override styles = [css`${unsafeCSS(uiIconStyle)}`, interactiveSurfaceStyles, barKeyStyles, css`
    :host { display: block; }
    .offer { display: grid; gap: var(--pi-space-5); padding: var(--pi-space-6); color: var(--pi-text); }
    header { display: grid; gap: var(--pi-space-2); }
    .title { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); }
    h2 { margin: 0; font-size: var(--pi-text-lg); font-weight: var(--pi-weight-strong); }
    p { margin: 0; color: var(--pi-muted); }
    .steps { margin: 0; padding: var(--pi-space-4) var(--pi-space-5); list-style: none; counter-reset: step; display: grid; gap: var(--pi-space-4); border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-md); background: var(--pi-surface-canvas, var(--pi-bg)); font-size: var(--pi-text-sm); line-height: var(--pi-leading-normal); }
    .steps li { counter-increment: step; display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: var(--pi-space-4); align-items: start; }
    .steps li::before { content: counter(step); box-sizing: border-box; display: grid; place-items: center; width: 20px; height: 20px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); color: var(--pi-muted); font-size: var(--pi-text-2xs); font-weight: var(--pi-weight-semibold); line-height: 1; }
    .share-glyph { display: inline-flex; vertical-align: -0.2em; color: var(--pi-accent); }
    .share-glyph .ui-icon { width: 16px; height: 16px; }
    footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--pi-space-4) var(--pi-space-3); }
    .action { position: relative; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-6); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: var(--pi-text-sm) var(--pi-font-ui); white-space: nowrap; text-decoration: none; cursor: pointer; }
    .action.install { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent, var(--pi-bg)); font-weight: var(--pi-weight-semibold); }
    .action.docs { border-color: var(--pi-accent-border); color: var(--pi-accent); }
    .action:disabled { opacity: var(--pi-disabled-opacity); cursor: default; }
    .action:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
    @media (hover: hover) { .action:not(:disabled):not(.install):hover { background: var(--pi-surface-hover); } }
    @media (pointer: coarse) { .action::after { content: ""; position: absolute; inset: calc((var(--pi-control-height-comfort) - var(--pi-control-height-touch)) / 2 - 1px) -1px; } }
    .share-pill { position: fixed; z-index: var(--pi-layer-popover); box-sizing: border-box; display: inline-flex; align-items: center; gap: var(--pi-space-3); height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-6) 0 var(--pi-space-5); border: 1px solid var(--pi-accent-border); border-radius: var(--pi-radius-pill); background: var(--pi-surface); color: var(--pi-accent); font: var(--pi-weight-semibold) var(--pi-text-sm) var(--pi-font-ui); pointer-events: none; }
    .share-pill .ui-icon { width: 18px; height: 18px; }
    .share-pill.bottom-center { bottom: calc(env(safe-area-inset-bottom) + var(--pi-space-3)); left: 50%; transform: translateX(-50%); }
    .share-pill.bottom-right { bottom: calc(env(safe-area-inset-bottom) + var(--pi-space-3)); right: calc(env(safe-area-inset-right) + var(--pi-space-4)); }
    .share-pill.top-right { top: calc(env(safe-area-inset-top) + var(--pi-space-3)); right: calc(env(safe-area-inset-right) + var(--pi-space-4)); }
  `];

  override connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = installPromptCapture.subscribe(this.onCaptureChange);
  }

  override disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    super.disconnectedCallback();
  }

  private readonly onCaptureChange = (): void => {
    if (installPromptCapture.appInstalled) {
      this.onAnswer?.({ version: 1, choice: "installed" });
      return;
    }
    this.requestUpdate();
  };

  private readonly install = async (): Promise<void> => {
    this.prompting = true;
    const outcome = await installPromptCapture.prompt();
    this.prompting = false;
    const record = recordAfterPrompt(outcome, Date.now());
    if (record !== undefined) this.onAnswer?.(record);
  };

  private readonly primaryAction: Readonly<Record<InstallHintPrimary, () => TemplateResult>> = {
    install: () => html`<button type="button" class="action install" ?disabled=${this.prompting} @click=${() => { void this.install(); }}>Install</button>`,
    "https-docs": () => html`<a class="action docs" href=${INSTALL_HTTPS_DOCS_URL} target="_blank" rel="noopener noreferrer">Set up HTTPS</a>`,
  };

  override willUpdate(): void {
    this.words = INSTALL_HINT_WORDS[browserInstallHintState(this.runningInstalled, this.prompting || installPromptCapture.promptAvailable)];
  }

  override updated(): void {
    if (this.words === undefined) this.onAnswer?.(undefined);
  }

  override render() {
    const words = this.words;
    if (words === undefined) return nothing;
    return html`
      <section class="offer">
        <header>
          <div class="title">
            <h2>${OFFER_LABEL}</h2>
            <button type="button" class="bar-key" aria-label="Close" @click=${() => { this.onAnswer?.(laterRecord()); }}>${renderCrossIcon()}</button>
          </div>
          <p>${words.message}</p>
        </header>
        ${words.steps === undefined ? nothing : html`<ol class="steps">${STEPS[words.steps]()}</ol>`}
        ${words.note === undefined ? nothing : html`<p>${words.note}</p>`}
        <footer>
          ${words.primary === undefined ? nothing : this.primaryAction[words.primary]()}
          <button type="button" class="action" @click=${() => { this.onAnswer?.(laterRecord()); }}>Later</button>
          <button type="button" class="action" @click=${() => { this.onAnswer?.({ version: 1, choice: "never" }); }}>Don't show again</button>
        </footer>
      </section>
      ${words.steps === "ios-share" ? renderSharePill(shareButtonGuess(classifyInstallPlatform(navigator.userAgent, navigator.maxTouchPoints))) : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "install-app-offer": InstallAppOffer;
  }
}
