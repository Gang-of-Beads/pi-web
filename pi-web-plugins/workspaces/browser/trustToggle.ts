import { css, html, nothing, type ReactiveControllerHost, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { describeError } from "./errors";

export function menuDomId(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/** Host-provided trust reads and writes for listed rows (projects or workspaces), keyed by row id. */
export interface TrustActions {
  get(id: string): Promise<{ trusted: boolean }>;
  set(id: string, trusted: boolean): Promise<{ trusted: boolean }>;
}

interface TrustToggleState {
  loading?: boolean;
  saving?: boolean;
  trusted?: boolean;
  error?: string;
}

/**
 * The Trusted checkbox in a row's menu, one per row id: read when the menu opens, written when
 * the reader flips it. The checkbox stays indeterminate until the first read answers; a failed
 * write keeps the value it had, with the reason under it, and the box is set back to that value
 * (`live`), since the reader's click already flipped it. Without host trust actions there is
 * no checkbox, as the plugin API's `workspaceTrust` and `projectTrust` say: absent means the
 * rows omit trust.
 */
export class TrustToggles {
  private states: Readonly<Record<string, TrustToggleState>> = {};

  constructor(private readonly host: Pick<ReactiveControllerHost, "requestUpdate">, private readonly actions: () => TrustActions | undefined) {}

  async load(id: string): Promise<void> {
    const actions = this.actions();
    const existing = this.states[id];
    if (actions === undefined || existing?.loading === true || existing?.saving === true) return;
    this.put(id, { ...settled(existing), loading: true });
    try {
      this.put(id, { trusted: (await actions.get(id)).trusted });
    } catch (error) {
      this.put(id, { error: describeError(error) });
    }
  }

  async set(id: string, trusted: boolean): Promise<void> {
    const actions = this.actions();
    if (actions === undefined) return;
    const existing = this.states[id];
    this.put(id, { ...settled(existing), saving: true });
    try {
      this.put(id, { trusted: (await actions.set(id, trusted)).trusted });
    } catch (error) {
      this.put(id, { ...settled(existing), error: describeError(error) });
    }
  }

  render(id: string, inputId: string): TemplateResult | typeof nothing {
    if (this.actions() === undefined) return nothing;
    const state = this.states[id];
    const busy = state?.loading === true || state?.saving === true;
    return html`
      <div class="menu-trust">
        <div class="menu-trust-row">
          <label for=${inputId}>
            <input
              id=${inputId}
              type="checkbox"
              .checked=${live(state?.trusted === true)}
              .indeterminate=${live(state?.trusted === undefined)}
              ?disabled=${busy || state?.trusted === undefined}
              @change=${(event: Event) => { if (event.target instanceof HTMLInputElement) void this.set(id, event.target.checked); }}
            />
            <span>Trusted${busy ? "…" : ""}</span>
          </label>
          <a class="menu-trust-link" href="https://pi.dev/docs/latest/security" target="_blank" rel="noreferrer">Learn about project trust</a>
        </div>
        ${state?.error === undefined ? null : html`<small class="menu-trust-error">${state.error}</small>`}
      </div>
    `;
  }

  private put(id: string, state: TrustToggleState): void {
    this.states = { ...this.states, [id]: state };
    this.host.requestUpdate();
  }
}

/** The value worth carrying across a read or a write, without the previous one's error. */
function settled(state: TrustToggleState | undefined): TrustToggleState {
  return state?.trusted === undefined ? {} : { trusted: state.trusted };
}

export const trustToggleStyles = css`
  .menu-trust { display: flex; flex-direction: column; gap: var(--pi-space-2); padding: var(--pi-space-2) var(--pi-space-1); }
  .menu-trust-row { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); }
  .menu-trust label { display: flex; align-items: center; gap: var(--pi-space-3); cursor: pointer; }
  @media (pointer: coarse) { .menu-trust label { min-height: var(--pi-control-height-touch); } }
  .menu-trust input { box-sizing: border-box; width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); margin: 0; accent-color: var(--pi-accent); cursor: pointer; }
  .menu-trust-link { display: inline-flex; align-items: center; min-height: var(--pi-control-height); color: var(--pi-accent); font-size: var(--pi-text-xs); text-align: right; white-space: nowrap; }
  .menu-trust-error { color: var(--pi-danger, #c0392b); line-height: 1.3; }
`;
