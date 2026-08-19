import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { writeClipboardText } from "../clipboard";
import { toSafeMarkdownHtml } from "../formatting/markdown";
import { formattedTextStyles } from "./shared";

/**
 * Fully parse a message's markdown once the stream has been quiet for this
 * long. While deltas keep arriving we render the parsed prefix plus a plain
 * text suffix, so token-by-token streaming costs O(delta) instead of
 * re-running `marked.parse` + DOM rebuild on the whole accumulated message
 * every frame (the dominant web-vs-TUI slowdown).
 */
export const STREAM_SETTLE_MS = 350;

@customElement("formatted-text")
export class FormattedText extends LitElement {
  @property() text = "";

  /** Text that has a full markdown render committed to `parsedHtml`. */
  private parsedText = "";
  private parsedHtml = "";
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private enhancedForHtml = "";

  override render() {
    // Append-only growth reuses the last committed parse: the parsed prefix
    // keeps its DOM (unsafeHTML string is unchanged, so Lit does not touch
    // it) and only the suffix span is updated per delta.
    const isAppend = this.parsedText.length > 0 && this.text.startsWith(this.parsedText) && this.text.length > this.parsedText.length;
    if (!isAppend) {
      if (this.text !== this.parsedText) {
        this.parsedHtml = toSafeMarkdownHtml(this.text);
        this.parsedText = this.text;
      }
      this.settleTimer = undefined;
      this.streamingSuffix = "";
      return html`<div class="formatted" dir="auto" @click=${this.onFormattedClick}>${unsafeHTML(this.parsedHtml)}</div>`;
    }
    const suffix = this.text.slice(this.parsedText.length);
    this.streamingSuffix = suffix;
    this.scheduleSettleParse();
    return html`<div class="formatted" dir="auto" @click=${this.onFormattedClick}>${unsafeHTML(this.parsedHtml)}${suffix === "" ? "" : html`<span class="stream-suffix">${suffix}</span>`}</div>`;
  }

  private streamingSuffix = "";

  override updated(): void {
    if (this.enhancedForHtml === this.parsedHtml) return;
    this.enhancedForHtml = this.parsedHtml;
    this.enhanceCodeBlocks();
  }

  private scheduleSettleParse(): void {
    if (this.settleTimer !== undefined) return;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      if (this.parsedText === this.text) return;
      this.parsedHtml = toSafeMarkdownHtml(this.text);
      this.parsedText = this.text;
      this.streamingSuffix = "";
      this.requestUpdate();
    }, STREAM_SETTLE_MS);
  }

  private enhanceCodeBlocks(): void {
    this.renderRoot.querySelectorAll("pre").forEach((element) => {
      if (!(element instanceof HTMLPreElement) || element.parentElement?.classList.contains("code-block-wrapper") === true) return;
      const code = element.querySelector("code");
      if (!(code instanceof HTMLElement)) return;
      const wrapper = document.createElement("div");
      wrapper.className = "code-block-wrapper";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "code-copy-button";
      button.title = "Copy code block";
      button.setAttribute("aria-label", "Copy code block");
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "⧉";
      button.append(icon);
      element.before(wrapper);
      wrapper.append(element, button);
    });
  }  private readonly onFormattedClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest(".code-copy-button");
    if (!(button instanceof HTMLButtonElement)) return;
    const wrapper = button.closest(".code-block-wrapper");
    if (!(wrapper instanceof HTMLElement)) return;
    const code = wrapper.querySelector("pre code");
    if (!(code instanceof HTMLElement)) return;
    void this.copyCode(code.textContent, button);
  };

  private async copyCode(text: string, button: HTMLButtonElement): Promise<void> {
    const copied = await writeClipboardText(text);
    this.setCopyButtonState(button, copied ? "copied" : "failed");
    window.setTimeout(() => {
      this.setCopyButtonState(button, "idle");
    }, 1200);
  }

  private setCopyButtonState(button: HTMLButtonElement, state: "idle" | "copied" | "failed"): void {
    const icon = button.querySelector("span");
    if (icon !== null) icon.textContent = state === "copied" ? "✓" : "⧉";
    const label = state === "copied" ? "Copied code block" : state === "failed" ? "Failed to copy code block" : "Copy code block";
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  static override styles = formattedTextStyles;
}
