import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { settingsControlStyles } from "./settingsControlStyles.js";
import { customElement, property } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";

export const SETTINGS_NOTICE_TONES = ["error", "success", "warning", "info"] as const;
export type SettingsNoticeTone = (typeof SETTINGS_NOTICE_TONES)[number];

export const SETTINGS_NOTICE_TYPES = ["availability", "error", "success", "security", "warning", "info"] as const;
export type SettingsNoticeType = (typeof SETTINGS_NOTICE_TYPES)[number];

export type SettingsNoticeRole = "alert" | "note" | "status";
export type SettingsNoticeContent = string | TemplateResult;

export interface SettingsNotice {
  readonly type: SettingsNoticeType;
  readonly content: SettingsNoticeContent;
  readonly tone?: SettingsNoticeTone;
  readonly title?: string;
  readonly role?: SettingsNoticeRole;
}

const DEFAULT_NOTICE_TONE: Record<SettingsNoticeType, SettingsNoticeTone> = {
  availability: "error",
  error: "error",
  success: "success",
  security: "warning",
  warning: "warning",
  info: "info",
};

export function settingsNoticeTone(notice: SettingsNotice): SettingsNoticeTone {
  return notice.tone ?? DEFAULT_NOTICE_TONE[notice.type];
}

@customElement("settings-panel-frame")
export class SettingsPanelFrame extends LitElement {
  @property() heading = "";
  @property({ attribute: false }) description: SettingsNoticeContent = "";
  @property() actionLabel = "";
  @property() actionTitle = "";
  @property({ type: Boolean }) actionDisabled = false;
  @property({ attribute: false }) notices: readonly SettingsNotice[] = [];
  @property({ attribute: false }) onAction?: () => void | Promise<void>;

  override render(): TemplateResult {
    return html`
      <section class="panel" aria-label=${this.heading || "Settings panel"}>
        <header class="section-heading">
          <div class="heading-copy">
            ${this.heading === "" ? nothing : html`<h2>${this.heading}</h2>`}
            <div class="description"><slot name="description">${this.description}</slot></div>
          </div>
          <div class="heading-actions"><slot name="actions">${this.renderDefaultAction()}</slot></div>
        </header>
        ${this.renderNoticeStack()}
        <div class="content"><slot></slot></div>
      </section>
    `;
  }

  private renderDefaultAction(): TemplateResult | typeof nothing {
    if (this.actionLabel === "") return nothing;
    return html`
      <button
        class="secondary"
        title=${this.actionTitle || this.actionLabel}
        ?disabled=${this.actionDisabled}
        @click=${() => { void this.onAction?.(); }}
      >${this.actionLabel}</button>
    `;
  }

  private renderNoticeStack(): TemplateResult | typeof nothing {
    if (this.notices.length === 0) return nothing;
    return html`
      <div class="notice-stack" aria-label="Settings notices">
        ${this.notices.map((notice) => this.renderNotice(notice))}
      </div>
    `;
  }

  private renderNotice(notice: SettingsNotice): TemplateResult {
    const tone = settingsNoticeTone(notice);
    const role = notice.role ?? defaultNoticeRole(tone);
    const title = notice.title;
    return html`
      <article class=${`notice ${tone}`} role=${role}>
        ${title === undefined || title === "" ? nothing : html`<strong class="notice-title">${title}</strong>`}
        <div class="notice-content">${notice.content}</div>
      </article>
    `;
  }

  static override styles = [interactiveSurfaceStyles, settingsControlStyles, css`
    :host { display: block; }
    .panel { display: block; }
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--pi-space-7); margin-bottom: var(--pi-space-7); }
    .heading-copy { display: grid; gap: var(--pi-space-3); min-width: 0; }
    .heading-actions { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-4); }
    h2 { margin: 0; font-size: var(--pi-text-lg); line-height: 1.25; }
    .description { color: var(--pi-muted); line-height: 1.45; }
    .description ::slotted(*) { margin: 0; }
    button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); font: inherit; cursor: pointer; }
    button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    .secondary { flex: 0 0 auto; }
    .notice-stack { display: grid; gap: var(--pi-space-6); margin-bottom: var(--pi-space-7); }
    .notice { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); padding: var(--pi-space-6); line-height: 1.45; }
    .notice.error { border-color: var(--pi-danger); color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-surface)); }
    .notice.success { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-surface); }
    .notice.warning { border-color: var(--pi-warning-border); color: var(--pi-text); background: var(--pi-warning-surface); }
    .notice.info { color: var(--pi-muted); }
    .notice-title { display: block; margin-bottom: var(--pi-space-2); color: inherit; }
    .notice-content { min-width: 0; }
    code { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-xs); background: var(--pi-bg); padding: var(--pi-space-1) var(--pi-space-2); color: var(--pi-text); font: var(--pi-text-xs) var(--pi-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); overflow-wrap: anywhere; }
    .content { display: grid; gap: var(--pi-space-7); min-width: 0; }
    .content ::slotted(*) { min-width: 0; }

    @media (max-width: 760px) {
      .section-heading { display: grid; gap: var(--pi-space-6); }
      .heading-actions { justify-self: start; }
    }
  `];
}

function defaultNoticeRole(tone: SettingsNoticeTone): SettingsNoticeRole {
  switch (tone) {
    case "error": return "alert";
    case "success": return "status";
    case "warning":
    case "info": return "note";
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-panel-frame": SettingsPanelFrame;
  }
}
