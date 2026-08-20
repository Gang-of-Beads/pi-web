import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { QualifiedContributionId, QualifiedThemeContribution, ThemeTokens } from "../../plugins/types";

/**
 * Choosing how the app looks, where looking for it makes sense.
 *
 * Theme selection used to be an entry in the command palette and nowhere else:
 * a text list of names, with no way to see what any of them did and no visible
 * door into it. Appearance is a settings section now, each theme shows the
 * colours it will actually apply, and following the system is a switch next to
 * them rather than a hidden mode.
 *
 * Themes are contributed by plugins, so this renders whatever the registry
 * reports rather than a fixed list.
 */
@customElement("settings-appearance-panel")
export class SettingsAppearancePanel extends LitElement {
  @property({ attribute: false }) themes: readonly QualifiedThemeContribution[] = [];
  /** The theme the user picked, which `auto` may override at render time. */
  @property({ attribute: false }) selectedThemeId?: QualifiedContributionId;
  /** The theme actually applied right now. */
  @property({ attribute: false }) activeThemeId?: QualifiedContributionId;
  @property({ type: Boolean }) followSystem = false;
  @property({ attribute: false }) onSelectTheme?: (themeId: QualifiedContributionId) => void;
  @property({ attribute: false }) onToggleFollowSystem?: (follow: boolean) => void;

  override render() {
    return html`
      <settings-panel-frame>
        <div class="heading">
          <div>
            <h2>Appearance</h2>
            <p class="muted">Pick a theme, or let the system's light and dark preference choose between a matching pair.</p>
          </div>
        </div>

        <label class="follow">
          <input
            type="checkbox"
            .checked=${this.followSystem}
            @change=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.onToggleFollowSystem?.(event.target.checked); }}
          >
          <span>
            <span class="follow-title">Follow the system</span>
            <span class="muted">Switches between the light and dark themes of the pair you chose.</span>
          </span>
        </label>

        <div class="theme-grid">
          ${this.themes.map((theme) => this.renderTheme(theme))}
          ${this.themes.length === 0 ? html`<p class="muted">No themes are installed.</p>` : nothing}
        </div>
      </settings-panel-frame>
    `;
  }

  private renderTheme(theme: QualifiedThemeContribution) {
    const selected = this.selectedThemeId === theme.id;
    const active = this.activeThemeId === theme.id;
    return html`
      <button
        type="button"
        class=${`theme ${selected ? "selected" : ""} ${active ? "active" : ""}`}
        aria-pressed=${selected ? "true" : "false"}
        @click=${() => { this.onSelectTheme?.(theme.id); }}
      >
        ${this.renderPreview(theme.tokens)}
        <span class="theme-name">${theme.name}</span>
        <span class="theme-scheme muted">${theme.colorScheme === "light" ? "Light" : "Dark"}${active && !selected ? " · in use" : ""}</span>
        ${theme.description === undefined ? nothing : html`<span class="theme-description muted">${theme.description}</span>`}
      </button>
    `;
  }

  /**
   * A miniature of the app rather than a row of swatches: the surface on the
   * background, a line of text, and the accent - which is what actually differs
   * between two themes that share a palette.
   */
  private renderPreview(tokens: ThemeTokens) {
    const style = (names: readonly (keyof ThemeTokens)[]) => names
      .map((name) => `${name.replace("--pi-", "--preview-")}: ${tokens[name]}`)
      .join("; ");
    return html`
      <span
        class="preview"
        aria-hidden="true"
        style=${style(["--pi-bg", "--pi-surface", "--pi-border", "--pi-text", "--pi-muted", "--pi-accent", "--pi-success", "--pi-warning", "--pi-danger"])}
      >
        <span class="preview-surface">
          <span class="preview-line long"></span>
          <span class="preview-line short"></span>
        </span>
        <span class="preview-dots">
          <span class="preview-dot accent"></span>
          <span class="preview-dot success"></span>
          <span class="preview-dot warning"></span>
          <span class="preview-dot danger"></span>
        </span>
      </span>
    `;
  }

  static override styles = css`
    :host { display: block; color: var(--pi-text); font: 14px system-ui, sans-serif; }
    .heading { margin-bottom: 12px; }
    h2 { margin: 0 0 4px; font-size: 15px; }
    .muted { margin: 0; color: var(--pi-muted); font-size: 12px; line-height: 1.4; }
    .follow { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 14px; padding: 10px; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); cursor: pointer; }
    .follow input { width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--pi-accent); }
    .follow span { display: grid; gap: 2px; }
    .follow-title { font-weight: 600; }
    .theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
    .theme { display: grid; gap: 4px; padding: 10px; border: 1px solid var(--pi-border); border-radius: 12px; background: var(--pi-surface); color: var(--pi-text); font: inherit; text-align: left; cursor: pointer; }
    .theme:hover { border-color: var(--pi-accent); }
    .theme:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
    .theme.selected { border-color: var(--pi-accent); box-shadow: 0 0 0 1px var(--pi-accent) inset; }
    .theme-name { font-weight: 600; }
    .theme-scheme, .theme-description { font-size: 11px; }
    .preview { display: grid; gap: 6px; height: 74px; margin-bottom: 6px; padding: 8px; border: 1px solid var(--preview-border, var(--pi-border)); border-radius: 8px; background: var(--preview-bg, var(--pi-bg)); }
    .preview-surface { display: grid; align-content: center; gap: 5px; padding: 6px 7px; border: 1px solid var(--preview-border, var(--pi-border)); border-radius: 6px; background: var(--preview-surface, var(--pi-surface)); }
    .preview-line { display: block; height: 5px; border-radius: 999px; background: var(--preview-text, var(--pi-text)); }
    .preview-line.long { width: 78%; }
    .preview-line.short { width: 46%; background: var(--preview-muted, var(--pi-muted)); }
    .preview-dots { display: flex; gap: 5px; }
    .preview-dot { width: 10px; height: 10px; border-radius: 50%; }
    .preview-dot.accent { background: var(--preview-accent, var(--pi-accent)); }
    .preview-dot.success { background: var(--preview-success, var(--pi-success)); }
    .preview-dot.warning { background: var(--preview-warning, var(--pi-warning)); }
    .preview-dot.danger { background: var(--preview-danger, var(--pi-danger)); }
    @media (max-width: 760px) {
      .theme-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
      .preview { height: 64px; }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-appearance-panel": SettingsAppearancePanel;
  }
}
