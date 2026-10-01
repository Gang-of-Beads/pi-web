import { LitElement, css, html } from "lit";
import { property } from "lit/decorators.js";
import { backgroundTaskList, listNote, type TaskInput, type TaskRow, type TasksRead } from "./backgroundTaskRows.js";

/**
 * This session's background runs, as the plugin's own list in the ≡ menu.
 *
 * The core only hosts the panel; the rows, their words and their look belong here, so the
 * shell learns nothing about background work beyond "a panel with something to show".
 */
export class BackgroundTasksList extends LitElement {
  @property({ attribute: false }) tasks: readonly TaskInput[] = [];
  @property({ attribute: false }) read: TasksRead = "unread";

  static override styles = css`
    :host { display: contents; }
    .viewer { flex: 1 1 auto; box-sizing: border-box; min-height: 0; overflow: auto; padding: var(--pi-space-5) var(--pi-reading-edge); color: var(--pi-text); font: var(--pi-text-sm) var(--pi-font-ui, system-ui, sans-serif); }
    .group { margin: 0; padding: 0; list-style: none; }
    .group + .group { margin-top: var(--pi-space-4); }
    .heading { margin: 0 0 var(--pi-space-2); color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .task { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: baseline; column-gap: var(--pi-space-3); row-gap: var(--pi-space-1); padding: var(--pi-space-3) 0; border-top: 1px solid var(--pi-border-muted); }
    .task:first-child { border-top: 0; }
    .dot { width: var(--pi-dot-sm); height: var(--pi-dot-sm); border-radius: 50%; background: currentColor; align-self: center; }
    .name { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
    .status { font-size: var(--pi-text-xs); white-space: nowrap; }
    .detail { grid-column: 2 / 4; color: var(--pi-muted); font-size: var(--pi-text-xs); font-variant-numeric: tabular-nums; }
    .running { color: var(--pi-purple); }
    .done { color: var(--pi-success); }
    .problem { color: var(--pi-danger); }
    .unknown { color: var(--pi-muted); }
    .task .name { color: var(--pi-text); }
    .more { margin: var(--pi-space-3) 0 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .note { margin: 0 0 var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-xs); }
  `;

  override render() {
    const list = backgroundTaskList(this.tasks);
    const note = listNote(this.read, this.tasks.length);
    return html`<div class="viewer">
      ${note === undefined ? null : html`<p class="note" role="status">${note}</p>`}
      ${list.running.length === 0 ? null : html`
        <p class="heading">Running</p>
        <ul class="group">${list.running.map((task) => this.renderTask(task))}</ul>
      `}
      ${list.finished.length === 0 ? null : html`
        <p class="heading">Finished</p>
        <ul class="group">${list.finished.map((task) => this.renderTask(task))}</ul>
      `}
      ${list.hiddenFinished === 0 ? null : html`<p class="more">${String(list.hiddenFinished)} older ${list.hiddenFinished === 1 ? "run" : "runs"} not shown</p>`}
    </div>`;
  }

  private renderTask(task: TaskRow) {
    return html`
      <li class=${`task ${task.tone}`}>
        <span class="dot" aria-hidden="true"></span>
        <span class="name" title=${task.name}>${task.name}</span>
        <span class=${`status ${task.tone}`}>${task.label}</span>
        ${task.detail === "" ? null : html`<span class="detail">${task.detail}</span>`}
      </li>
    `;
  }
}

if (customElements.get("pi-web-background-tasks") === undefined) customElements.define("pi-web-background-tasks", BackgroundTasksList);
