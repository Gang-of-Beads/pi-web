import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { offersReply, replyMessage, supervisorTitle, type SupervisorRequest } from "./supervisorRequest.js";

/**
 * The card a supervisor request draws in the transcript. It owns the reply
 * draft; the host owns sending, because a browser's only channel into a
 * running agent is this session's own prompt.
 */
@customElement("pi-subagent-supervisor-card")
export class SubagentSupervisorCard extends LitElement {
  @property({ attribute: false }) request?: SupervisorRequest;
  @property({ attribute: false }) onSend?: (text: string) => void | Promise<void>;
  @property({ attribute: false }) onInsert?: (text: string) => void;

  @state() private draft = "";
  @state() private sent = false;

  override render() {
    const request = this.request;
    if (request === undefined) return html`<strong>Subagent message</strong>`;
    return html`
      <strong>${supervisorTitle(request)}</strong>
      ${request.runId === undefined ? null : html`<small class="run">Run ${request.runId}</small>`}
      ${offersReply(request) ? this.renderReply(request) : html`<small class="quiet">No reply expected.</small>`}
    `;
  }

  private renderReply(request: SupervisorRequest) {
    if (this.sent) return html`<small class="quiet">Reply sent to this session, which relays it to the child.</small>`;
    return html`
      <div class="reply">
        <input
          class="reply-input"
          aria-label="Reply to this subagent"
          placeholder="Reply…"
          .value=${this.draft}
          @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.draft = event.target.value; }}
        >
        <div class="reply-actions">
          <button type="button" ?disabled=${this.draft.trim() === "" || this.onSend === undefined} @click=${() => { void this.send(request); }}>Send</button>
          <button type="button" ?disabled=${this.draft.trim() === "" || this.onInsert === undefined} @click=${() => { this.onInsert?.(replyMessage(request, this.draft)); }}>Edit in composer</button>
        </div>
        <small class="quiet">Sent to this session as a message; the agent relays it to the child.</small>
      </div>
    `;
  }

  private async send(request: SupervisorRequest): Promise<void> {
    const text = this.draft.trim();
    if (text === "" || this.onSend === undefined) return;
    await this.onSend(replyMessage(request, text));
    this.draft = "";
    this.sent = true;
  }

  static override styles = css`
    :host { display: block; }
    strong { display: block; color: var(--pi-text); }
    small { display: block; color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .run { font-family: var(--pi-font-mono); }
    .reply { display: flex; flex-direction: column; gap: var(--pi-space-3); margin-top: var(--pi-space-3); }
    .reply-input { box-sizing: border-box; width: 100%; min-height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); font: inherit; }
    .reply-actions { display: flex; gap: var(--pi-space-3); }
    .reply-actions button { box-sizing: border-box; min-height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: inherit; }
    .reply-actions button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    @media (pointer: coarse) {
      .reply-input, .reply-actions button { min-height: var(--pi-control-height-touch); }
    }
  `;
}

export function defineSupervisorCard(): void {
  void SubagentSupervisorCard;
}

declare global {
  interface HTMLElementTagNameMap {
    "pi-subagent-supervisor-card": SubagentSupervisorCard;
  }
}
