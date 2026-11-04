import { css, html, nothing, type ReactiveControllerHost, type TemplateResult } from "lit";
import { describeError } from "../../notice";
import { interactiveSurfaceStyles } from "../shared";
import { renderCheckIcon } from "../uiIcons";

/** Reads and writes the trust of a project's folder on a machine. */
export interface ProjectTrustActions {
  get(machineId: string, projectId: string): Promise<{ trusted: boolean }>;
  set(machineId: string, projectId: string, trusted: boolean): Promise<{ trusted: boolean }>;
}

/** What the item is doing for its project: reading the answer, or writing the reader's choice. */
type ItemWork = "reading" | "saving";

interface ItemState {
  trusted?: boolean;
  work?: ItemWork;
  error?: string;
}

/** What the item can say: still reading, the answer, writing it, or no answer to give. */
type ItemView = ItemWork | "known" | "unreadable";

function itemView(state: ItemState | undefined): ItemView {
  if (state?.work !== undefined) return state.work;
  if (state?.trusted === undefined) return state?.error === undefined ? "reading" : "unreadable";
  return "known";
}

/**
 * Which views refuse a choice. Saving does not: disabling the button the reader just chose would
 * drop keyboard focus out of the open menu, and `toggle` already ignores a choice while one is
 * being written.
 */
const REFUSES_CHOICE: Readonly<Record<ItemView, boolean>> = {
  reading: true,
  known: false,
  saving: false,
  unreadable: true,
};

const LABELS: Readonly<Record<ItemView, string>> = {
  reading: "Trusted…",
  known: "Trusted",
  saving: "Trusted…",
  unreadable: "Trust unknown",
};

/**
 * The Trusted item of a project row's menu on the Navigate page, one per machine and project: read
 * when the menu opens, written when the reader chooses it, and the menu stays open to show the new
 * answer. Until a read answers the item says so and cannot be chosen; a read that failed says it
 * cannot tell, with the reason; a failed write keeps the answer it had and shows why. State is keyed
 * by machine and project, so another machine's project never shows this one's answer.
 */
export class ProjectTrustItems {
  private states: Readonly<Record<string, ItemState>> = {};

  constructor(private readonly host: Pick<ReactiveControllerHost, "requestUpdate">, private readonly actions: () => ProjectTrustActions | undefined) {}

  async load(machineId: string, projectId: string): Promise<void> {
    const actions = this.actions();
    const key = `${machineId}:${projectId}`;
    const existing = this.states[key];
    if (actions === undefined || existing?.work !== undefined) return;
    this.put(key, { ...known(existing), work: "reading" });
    try {
      this.put(key, { trusted: (await actions.get(machineId, projectId)).trusted });
    } catch (error) {
      this.put(key, { error: describeError(error) });
    }
  }

  async toggle(machineId: string, projectId: string): Promise<void> {
    const actions = this.actions();
    const key = `${machineId}:${projectId}`;
    const existing = this.states[key];
    if (actions === undefined || existing?.trusted === undefined || existing.work !== undefined) return;
    this.put(key, { trusted: existing.trusted, work: "saving" });
    try {
      this.put(key, { trusted: (await actions.set(machineId, projectId, !existing.trusted)).trusted });
    } catch (error) {
      this.put(key, { trusted: existing.trusted, error: describeError(error) });
    }
  }

  render(machineId: string, projectId: string): TemplateResult | typeof nothing {
    if (this.actions() === undefined) return nothing;
    const state = this.states[`${machineId}:${projectId}`];
    const view = itemView(state);
    return html`
      <button
        type="button"
        role="menuitemcheckbox"
        class="trust-item"
        aria-checked=${state?.trusted === undefined ? "mixed" : String(state.trusted)}
        title=${state?.error ?? "Whether pi loads this project's .pi settings, extensions, skills and packages"}
        ?disabled=${REFUSES_CHOICE[view]}
        aria-busy=${view === "saving" ? "true" : "false"}
        @click=${(event: MouseEvent) => { event.stopPropagation(); void this.toggle(machineId, projectId); }}
      >${LABELS[view]}<span class="trust-mark" aria-hidden="true">${state?.trusted === true ? renderCheckIcon() : nothing}</span></button>
      ${state?.error === undefined ? nothing : html`<small class="trust-item-error" role="none">${state.error}</small>`}
    `;
  }

  private put(key: string, state: ItemState): void {
    this.states = { ...this.states, [key]: state };
    this.host.requestUpdate();
  }
}

/** The answer worth keeping across a read, without a previous error. */
function known(state: ItemState | undefined): ItemState {
  return state?.trusted === undefined ? {} : { trusted: state.trusted };
}

export const projectTrustItemStyles = [interactiveSurfaceStyles, css`
  .action-menu-panel .trust-item { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); }
  .action-menu-panel .trust-item:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
  .trust-mark { display: inline-flex; width: 16px; height: 16px; flex: 0 0 16px; }
  .trust-mark svg { width: 16px; height: 16px; }
  .trust-item-error { display: block; padding: 0 var(--pi-space-5) var(--pi-space-3); color: var(--pi-danger); line-height: 1.3; }
`];
