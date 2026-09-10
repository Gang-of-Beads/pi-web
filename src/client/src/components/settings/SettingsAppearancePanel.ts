import { LitElement, css, html, nothing } from "lit";
import { settingsControlStyles } from "./settingsControlStyles.js";
import { customElement, property } from "lit/decorators.js";
import type { QualifiedContributionId, QualifiedThemeContribution, ThemeTokens } from "../../plugins/types";
import { interactiveSurfaceStyles } from "../shared";
import { CORE_PRO_THEME_ID } from "../../theme";
import { themeCardSuffix } from "../../themeCardLabel";

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
      <settings-panel-frame heading="Appearance">
        <p slot="description">Pick a theme, or let the system's light and dark preference choose between a matching pair.</p>

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
          ${this.renderNativePro()}
          ${this.themes.map((theme) => this.renderTheme(theme))}
          ${this.themes.length === 0 ? html`<p class="muted">No theme extensions are installed.</p>` : nothing}
        </div>
      </settings-panel-frame>
    `;
  }

  /** The core's own look: no plugin theme, the index.html defaults - the flat
   * mono TUI shape. Listed first so the way back is always the top card. */
  private renderNativePro() {
    const selected = this.selectedThemeId === CORE_PRO_THEME_ID;
    const active = this.activeThemeId === CORE_PRO_THEME_ID;
    return html`
      <button
        type="button"
        class=${`theme ${selected ? "selected" : ""} ${active ? "active" : ""}`}
        aria-pressed=${selected ? "true" : "false"}
        @click=${() => { this.onSelectTheme?.(CORE_PRO_THEME_ID); }}
      >
        <span class="theme-preview pro-preview" aria-hidden="true">
          <span class="pro-line"></span><span class="pro-line dim"></span><span class="pro-line dimmer"></span>
        </span>
        <span class="theme-name">Pro (native)</span>
        <span class="theme-scheme muted">Dark${themeCardSuffix({ selected, active, autoOverriding: this.followSystem })}</span>
        <span class="theme-description muted">The app's own flat mono look.</span>
      </button>
    `;
  }

  /**
   * Size is not zoom-with-reflow: it enlarges what is drawn and leaves the
   * layout breakpoints where they are, so the hint says so rather than letting
   * someone discover it by dragging the slider and getting a cramped desktop.
   */
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
        <span class="theme-scheme muted">${theme.colorScheme === "light" ? "Light" : "Dark"}${themeCardSuffix({ selected, active, autoOverriding: selected && !active })}</span>
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
      .map((name) => {
        const value = tokens[name];
        // A theme may leave a semantic ladder stop unset; the preview then
        // inherits the core fallback instead of shipping "undefined".
        return value === undefined ? undefined : `${name.replace("--pi-", "--preview-")}: ${value}`;
      })
      .filter((declaration) => declaration !== undefined)
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

  static override styles = [interactiveSurfaceStyles, settingsControlStyles, css`
    :host { display: block; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); line-height: inherit; }
    .heading { margin-bottom: var(--pi-space-6); }
    h2 { margin: 0 0 var(--pi-space-2); font-family: var(--pi-font-display); font-size: var(--pi-text-lg); font-weight: var(--pi-weight-semibold); letter-spacing: -0.01em; }
    .muted { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: 1.4; }
    .follow { display: flex; gap: var(--pi-space-5); margin-bottom: var(--pi-space-7); padding: var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); cursor: pointer; }
    .follow { align-items: center; }
    .follow input { flex: 0 0 auto; margin: 0; width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); accent-color: var(--pi-accent); }
    .follow span { display: grid; gap: var(--pi-space-1); }
    .follow-title { font-weight: var(--pi-weight-semibold); }
    .theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--pi-space-5); }
    .theme { display: grid; gap: var(--pi-space-2); padding: var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); font: inherit; text-align: left; cursor: pointer; }
    @media (hover: hover) { .theme:hover { border-color: var(--pi-accent); } }
    .theme:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
    .theme.selected { border-color: var(--pi-accent); box-shadow: 0 0 0 1px var(--pi-accent) inset; }
    /* The theme actually on screen is a state, not prose: it used to be an
       11px "· in use" suffix on a card drawn exactly like every unrelated one. */
    .theme.active:not(.selected) { border-color: var(--pi-border-strong, var(--pi-muted)); }
    .theme.active .theme-name::after { content: ""; display: inline-block; width: var(--pi-dot-sm); height: var(--pi-dot-sm); margin-left: var(--pi-space-3); border-radius: 50%; background: var(--pi-accent); vertical-align: middle; }
    .theme-name { font-weight: var(--pi-weight-semibold); }
    .theme-scheme, .theme-description { font-size: var(--pi-text-2xs); }
    /* The scheme line grew a suffix ("· in use", "· follows the system") and
       became the second variable-height line in a grid whose cards must match. */
    .theme-scheme { min-height: calc(2 * 1.4em); }
    /* Cards in a grid share a height: the description decides it, so it is
       clamped rather than left to the length of the sentence somebody wrote. */
    .theme-description { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; min-height: calc(2 * 1.4em); overflow: hidden; }
    /* Concentric by construction: an inner corner is the outer one minus the
       padding between them, so the two arcs stay parallel when either token
       moves. On the pro scale the card's lg(3) is smaller than the space-5
       padding, so the concentric clamp bottoms out at xs(0) - flat insides
       are the correct flat answer, not an accident. */
    .pro-preview { box-sizing: border-box; display: grid; gap: var(--pi-space-3); align-content: center; padding: var(--pi-space-4); height: 100%; background: var(--pi-surface); }
    .pro-line { display: block; height: var(--pi-dot-xs); width: 78%; background: var(--pi-text-bright); }
    .pro-line.dim { width: 62%; background: var(--pi-muted); }
    .pro-line.dimmer { width: 45%; background: var(--pi-dim); }
    .preview { box-sizing: border-box; display: grid; gap: var(--pi-space-3); height: 74px; margin-bottom: var(--pi-space-3); padding: var(--pi-space-4); border: 1px solid var(--preview-border, var(--pi-border)); border-radius: max(var(--pi-radius-xs), calc(var(--pi-radius-lg) - var(--pi-space-5))); background: var(--preview-bg, var(--pi-bg)); }
    .preview-surface { display: grid; align-content: center; gap: var(--pi-space-3); padding: var(--pi-space-3) var(--pi-space-4); border: 1px solid var(--preview-border, var(--pi-border)); border-radius: max(var(--pi-radius-xs), calc(var(--pi-radius-md) - var(--pi-space-4))); background: var(--preview-surface, var(--pi-surface)); }
    .preview-line { display: block; height: var(--pi-dot-xs); border-radius: var(--pi-radius-pill); background: var(--preview-text, var(--pi-text)); }
    .preview-line.long { width: 78%; }
    .preview-line.short { width: 46%; background: var(--preview-muted, var(--pi-muted)); }
    .preview-dots { display: flex; align-items: center; gap: var(--pi-space-3); }
    .preview-dot { width: var(--pi-dot-md); height: var(--pi-dot-md); border-radius: 50%; }
    .preview-dot.accent { background: var(--preview-accent, var(--pi-accent)); }
    .preview-dot.success { background: var(--preview-success, var(--pi-success)); }
    .preview-dot.warning { background: var(--preview-warning, var(--pi-warning)); }
    .preview-dot.danger { background: var(--preview-danger, var(--pi-danger)); }
    @media (max-width: 760px) {
      .theme-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--pi-space-4); }
      .preview { height: 64px; }
    }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-appearance-panel": SettingsAppearancePanel;
  }
}
