import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { QualifiedContributionId, QualifiedThemeContribution, ThemeTokens } from "../../plugins/types";
import { DEFAULT_UI_SCALE, MAX_UI_SCALE, MIN_UI_SCALE, UI_SCALE_STEP, uiScaleLabel } from "../../uiScale";

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
  /** Interface size, 1 being the size the design scale was drawn at. */
  @property({ type: Number }) uiScale = DEFAULT_UI_SCALE;
  @property({ attribute: false }) onChangeUiScale?: (scale: number) => void;

  override render() {
    return html`
      <settings-panel-frame>
        <div class="heading">
          <div>
            <h2>Appearance</h2>
            <p class="muted">Pick a theme, or let the system's light and dark preference choose between a matching pair.</p>
          </div>
        </div>

        ${this.renderScale()}

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

  /**
   * Size is not zoom-with-reflow: it enlarges what is drawn and leaves the
   * layout breakpoints where they are, so the hint says so rather than letting
   * someone discover it by dragging the slider and getting a cramped desktop.
   */
  private renderScale() {
    return html`
      <div class="scale">
        <label class="scale-label" for="ui-scale">
          <span class="follow-title">Interface size</span>
          <span class="scale-value">${uiScaleLabel(this.uiScale)}</span>
        </label>
        <input
          id="ui-scale"
          type="range"
          min=${MIN_UI_SCALE}
          max=${MAX_UI_SCALE}
          step=${UI_SCALE_STEP}
          .value=${String(this.uiScale)}
          aria-valuetext=${uiScaleLabel(this.uiScale)}
          @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.onChangeUiScale?.(Number.parseFloat(event.target.value)); }}
        >
        <p class="muted">Scales everything this device draws, and is remembered on this device only. It does not change the layout: a window stays as wide as it is, so a desktop keeps its columns.</p>
        ${this.uiScale === DEFAULT_UI_SCALE ? nothing : html`
          <button type="button" class="scale-reset" @click=${() => { this.onChangeUiScale?.(DEFAULT_UI_SCALE); }}>Reset to 100%</button>
        `}
      </div>
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
    :host { display: block; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
    .heading { margin-bottom: var(--pi-space-6); }
    h2 { margin: 0 0 var(--pi-space-2); font-family: var(--pi-font-display); font-size: var(--pi-text-lg); font-weight: var(--pi-weight-semibold); letter-spacing: -0.01em; }
    .muted { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: 1.4; }
    .follow { display: flex; align-items: flex-start; gap: var(--pi-space-5); margin-bottom: var(--pi-space-7); padding: var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); cursor: pointer; }
    .follow input { width: 18px; height: 18px; margin: var(--pi-space-1) 0 0; accent-color: var(--pi-accent); }
    .follow span { display: grid; gap: var(--pi-space-1); }
    .follow-title { font-weight: 600; }
    .scale { display: grid; gap: var(--pi-space-3); margin-bottom: var(--pi-space-7); padding: var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); }
    .scale-label { display: flex; align-items: baseline; justify-content: space-between; gap: var(--pi-space-4); cursor: pointer; }
    .scale-value { color: var(--pi-muted); font-variant-numeric: tabular-nums; }
    .scale input { width: 100%; margin: 0; accent-color: var(--pi-accent); }
    .scale input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
    .scale-reset { justify-self: start; min-height: var(--pi-control-height); padding: var(--pi-space-2) var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-bg); color: var(--pi-text); font: inherit; font-size: var(--pi-text-xs); cursor: pointer; }
    .scale-reset:hover { border-color: var(--pi-accent); }
    .scale-reset:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
    .theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--pi-space-5); }
    .theme { display: grid; gap: var(--pi-space-2); padding: var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); font: inherit; text-align: left; cursor: pointer; }
    .theme:hover { border-color: var(--pi-accent); }
    .theme:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
    .theme.selected { border-color: var(--pi-accent); box-shadow: 0 0 0 1px var(--pi-accent) inset; }
    .theme-name { font-weight: 600; }
    .theme-scheme, .theme-description { font-size: var(--pi-text-2xs); }
    .preview { display: grid; gap: var(--pi-space-3); height: 74px; margin-bottom: var(--pi-space-3); padding: var(--pi-space-4); border: 1px solid var(--preview-border, var(--pi-border)); border-radius: var(--pi-radius-md); background: var(--preview-bg, var(--pi-bg)); }
    .preview-surface { display: grid; align-content: center; gap: var(--pi-space-3); padding: var(--pi-space-3) var(--pi-space-4); border: 1px solid var(--preview-border, var(--pi-border)); border-radius: var(--pi-radius-sm); background: var(--preview-surface, var(--pi-surface)); }
    .preview-line { display: block; height: 5px; border-radius: var(--pi-radius-pill); background: var(--preview-text, var(--pi-text)); }
    .preview-line.long { width: 78%; }
    .preview-line.short { width: 46%; background: var(--preview-muted, var(--pi-muted)); }
    .preview-dots { display: flex; gap: var(--pi-space-3); }
    .preview-dot { width: 10px; height: 10px; border-radius: 50%; }
    .preview-dot.accent { background: var(--preview-accent, var(--pi-accent)); }
    .preview-dot.success { background: var(--preview-success, var(--pi-success)); }
    .preview-dot.warning { background: var(--preview-warning, var(--pi-warning)); }
    .preview-dot.danger { background: var(--preview-danger, var(--pi-danger)); }
    @media (max-width: 760px) {
      .theme-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--pi-space-4); }
      .preview { height: 64px; }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-appearance-panel": SettingsAppearancePanel;
  }
}
