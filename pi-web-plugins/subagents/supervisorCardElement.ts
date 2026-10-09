import { LitElement, css, html } from "lit";
import { property, state } from "lit/decorators.js";
import { replyMessage, supervisorTitle, type ReplyKind, type ReplyStanding, type SupervisorRequest } from "./supervisorRequest.js";

/**
 * The card a supervisor request draws in the transcript. It owns the reply
 * draft; the host owns sending, because a browser's only channel into a
 * running agent is this session's own prompt.
 */
export class SubagentSupervisorCard extends LitElement {
  @property({ attribute: false }) request?: SupervisorRequest;
  @property({ attribute: false }) onSend?: (text: string) => void | Promise<void>;
  @property({ attribute: false }) onInsert?: (text: string) => void;
  /** Where a reply stands, from the transcript: delivered, asked of the agent, open, or not expected. */
  @property({ attribute: false }) standing: ReplyStanding = { kind: "open", text: "" };

  @state() private draft = "";
  @state() private sent = false;

  /** The draft and a sent reply belong to one request: a card handed another starts empty. */
  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (!changed.has("request")) return;
    const previous = changed.get("request");
    if (previous === undefined || sameRequest(previous, this.request)) return;
    this.draft = "";
    this.sent = false;
  }

  override render() {
    const request = this.request;
    if (request === undefined) return html`<strong>Subagent message</strong>`;
    return html`
      <strong>${supervisorTitle(request)}</strong>
      ${request.runId === undefined ? null : html`<small class="run">Run ${request.runId}</small>`}
      ${request.body === undefined ? null : html`<p class="body">${request.body}</p>`}
      ${this.renderStanding(request)}
    `;
  }

  /** One drawing per standing; a reply sent from this card for this request counts as asked until the transcript shows it. */
  private renderStanding(request: SupervisorRequest) {
    const standing: ReplyStanding = this.standing.kind === "open" && this.sent ? { kind: "asked", text: "" } : this.standing;
    const drawings: Record<ReplyKind, (text: string) => unknown> = {
      "not-expected": () => html`<small class="quiet">No reply expected.</small>`,
      delivered: (text) => html`<small class="quiet">Delivered to ${request.agent ?? "the subagent"}: ${text}</small>`,
      asked: (text) => html`<small class="quiet">${text === "" ? "Reply sent to this session" : `Sent to this session: ${text}`}. Waiting for the agent to relay it to the child.</small>`,
      open: () => this.renderReply(request),
    };
    return drawings[standing.kind](standing.text);
  }

  private renderReply(request: SupervisorRequest) {
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
    .body { margin: var(--pi-space-3) 0 0; color: var(--pi-text); white-space: pre-wrap; overflow-wrap: anywhere; }
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

function sameRequest(previous: unknown, current: SupervisorRequest | undefined): boolean {
  if (current === undefined || typeof previous !== "object" || previous === null) return false;
  return Reflect.get(previous, "requestId") === current.requestId && Reflect.get(previous, "runId") === current.runId && Reflect.get(previous, "childTarget") === current.childTarget;
}

export function defineSupervisorCard(): void {
  void SubagentSupervisorCard;
}

declare global {
  interface HTMLElementTagNameMap {
    "pi-subagent-supervisor-card": SubagentSupervisorCard;
  }
}

if (customElements.get("pi-subagent-supervisor-card") === undefined) customElements.define("pi-subagent-supervisor-card", SubagentSupervisorCard);
