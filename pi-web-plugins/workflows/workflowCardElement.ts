import { LitElement, css, html } from "lit";
import { property } from "lit/decorators.js";
import type { AgentState, PhaseGroup, WorkflowProgress } from "./workflowProgress.js";

/** The tool call's status, as the host's ToolRendererViewModel reports it. */
export type CallState = "running" | "success" | "error" | "interrupted";

const AGENT_WORDS: Readonly<Record<AgentState, string>> = {
  running: "running",
  done: "done",
  error: "failed",
  skipped: "skipped",
  waiting: "waiting",
};

/** The word a call that is not running any more adds to the header after its counts; a running or successful call reads by its counts alone. */
const CALL_WORDS: Readonly<Record<CallState, string | undefined>> = {
  running: undefined,
  success: undefined,
  error: "failed",
  interrupted: "interrupted",
};

/**
 * A `workflow` tool call drawn as a card in the transcript (owner, 2026-10-12, mockup W2): the
 * workflow's name and its counts, a bar for the share done, then each phase with its agents, each
 * with a status dot; a failed agent says why. Every colour and size is the host's token.
 */
export class WorkflowCard extends LitElement {
  @property({ attribute: false }) progress?: WorkflowProgress;
  @property({ attribute: false }) call: CallState = "running";

  override render() {
    const progress = this.progress;
    if (progress === undefined) return null;
    const share = progress.total === 0 ? 0 : (progress.done / progress.total) * 100;
    const callWords = CALL_WORDS[this.call];
    return html`
      <div class="head">
        <span class="name"><span class="tool">workflow</span> · ${progress.name}</span>
        <span class="count">${this.countWords(progress)}${callWords === undefined ? "" : ` · ${callWords}`}</span>
      </div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax=${progress.total} aria-valuenow=${progress.done}><i style=${`width: ${String(share)}%`}></i></div>
      ${progress.phases.map((phase) => this.renderPhase(phase))}
    `;
  }

  private countWords(progress: WorkflowProgress): string {
    const parts = [`${String(progress.done)} of ${String(progress.total)} done`];
    if (progress.running > 0) parts.push(`${String(progress.running)} running`);
    if (progress.failed > 0) parts.push(`${String(progress.failed)} failed`);
    return parts.join(" · ");
  }

  private renderPhase(phase: PhaseGroup) {
    return html`
      <div class="phase"><b>${phase.name}</b><span>${phase.agents.length === 0 ? "waiting" : `${String(phase.done)} / ${String(phase.agents.length)}`}</span></div>
      ${phase.agents.map((agent) => html`
        <div class="agent">
          <span class="who">${agent.label}</span>
          <span class=${`state ${agent.state}`}>${AGENT_WORDS[agent.state]}</span>
          ${agent.note === undefined ? null : html`<span class=${`say ${agent.state}`}>${agent.note}</span>`}
        </div>
      `)}
    `;
  }

  static override styles = css`
    :host { display: block; box-sizing: border-box; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface-card, var(--pi-surface)); overflow: hidden; padding-bottom: var(--pi-space-3); font: var(--pi-text-base) var(--pi-font-ui); color: var(--pi-text); }
    .head { display: grid; grid-template-columns: 1fr auto; gap: var(--pi-space-1) var(--pi-space-4); align-items: baseline; padding: var(--pi-space-4) var(--pi-space-5); }
    .name { font-weight: var(--pi-weight-semibold); overflow-wrap: anywhere; }
    .tool { color: var(--pi-warning); }
    .count { font-size: var(--pi-text-xs); color: var(--pi-muted); text-align: right; }
    .bar { height: 2px; background: var(--pi-border-muted); }
    .bar i { display: block; height: 100%; background: var(--pi-warning); }
    .phase { display: flex; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-4) var(--pi-space-5) var(--pi-space-2); font-size: var(--pi-text-xs); color: var(--pi-muted); }
    .phase b { color: var(--pi-text); font-weight: var(--pi-weight-semibold); }
    .agent { display: grid; grid-template-columns: 1fr auto; gap: 0 var(--pi-space-4); padding: var(--pi-space-2) var(--pi-space-5); font-size: var(--pi-text-xs); }
    .who { overflow-wrap: anywhere; }
    .state { display: inline-flex; align-items: center; gap: var(--pi-space-2); color: var(--pi-muted); white-space: nowrap; }
    .state::before { content: ""; width: var(--pi-dot-sm); height: var(--pi-dot-sm); border-radius: 50%; background: currentcolor; }
    .state.done { color: var(--pi-success); }
    .state.running { color: var(--pi-warning); }
    .state.error { color: var(--pi-danger); }
    .say { grid-column: 1 / -1; color: var(--pi-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .say.error { color: var(--pi-danger); white-space: normal; overflow-wrap: anywhere; }
  `;
}

export const workflowCardTagName = "pi-web-workflow-card";

export function defineWorkflowCard(): void {
  if (!customElements.get(workflowCardTagName)) customElements.define(workflowCardTagName, WorkflowCard);
}
