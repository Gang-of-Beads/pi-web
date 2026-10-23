import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { writeClipboardText } from "../clipboard";
import { markdownStreamTail, toSafeMarkdownHtml } from "../formatting/markdown";
import { canAppendMarkdownTail, type MarkdownStreamTail } from "../formatting/markdownStreamTail";
import { FormattedTextDom, type MarkdownDomUpdate } from "./formattedTextDom";
import { codeFenceVerdict } from "../formatting/codeFence";
import { formattedTextStyles } from "./shared";
import { reportPluginFailure } from "../plugins/pluginContainment";

export interface CodeFenceRenderer {
  id?: string;
  machineId?: string;
  render: (source: string) => Node | Promise<Node>;
}

type CodeFenceLookup = (language: string) => CodeFenceRenderer | undefined;
interface CodeFenceClaim {
  readonly renderer: CodeFenceRenderer;
  readonly lookup: CodeFenceLookup;
  readonly revision: number;
  phase: "pending" | "settled";
}

/** Registry claims bind machine and generation; unqualified claims are scoped by lookup identity. */
function sameCodeFenceClaim(previous: CodeFenceClaim | undefined, lookup: CodeFenceLookup | undefined, language: string): boolean {
  if (previous === undefined || lookup === undefined) return false;
  const current = lookup(language);
  if (current === undefined || previous.renderer.id !== current.id || previous.renderer.machineId !== current.machineId) return false;
  return previous.renderer.id === undefined ? previous.lookup === lookup : previous.renderer.render === current.render;
}

/**
 * The code-block copy control is built through the DOM API rather than lit, so
 * its mark travels as markup. Same geometry as the drawn marks elsewhere: the
 * character it replaced took its ink from whichever font resolved it.
 */
const COPY_MARK = "<svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"9\" y=\"9\" width=\"11\" height=\"11\" rx=\"2\"></rect><path d=\"M5 15V5a2 2 0 0 1 2-2h8\"></path></svg>";
const COPIED_MARK = "<svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m5 12 5 5 9-10\"></path></svg>";

/** Periodic reconciliation for literal appends; structural changes use the canonical parser immediately. */
export const STREAM_SETTLE_MS = 350;

@customElement("formatted-text")
export class FormattedText extends LitElement {
  @property() text = "";
  /**
   * The host's lookup for a plugin that claims a fence language. Absent (the
   * default, and every non-transcript use) means every block stays plain.
   */
  @property({ attribute: false }) findCodeFenceRenderer?: CodeFenceLookup;
  /** True while this text's reply is still being written: fences are not claimed until the text has settled. */
  @property({ type: Boolean }) streaming = false;

  /** Text that has a full markdown render committed to `parsedHtml`. */
  private parsedText = "";
  private parsedHtml = "";
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly dom = new FormattedTextDom();
  private readonly claimedBy = new WeakMap<HTMLElement, CodeFenceClaim>();
  private needsDomReset = false;
  private sourceRevision = 0;
  private renderedText = "";
  private streamingSuffix = "";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.clearSettleTimer();
    this.dom.resetTail();
    this.sourceRevision += 1;
    super.disconnectedCallback();
  }

  override render() {
    if (this.renderedText !== this.text) {
      if (!this.text.startsWith(this.renderedText)) this.needsDomReset = true;
      this.renderedText = this.text;
      this.sourceRevision += 1;
    }
    const isAppend = this.parsedText.length > 0 && this.text.startsWith(this.parsedText) && this.text.length > this.parsedText.length;
    const suffix = isAppend ? this.text.slice(this.parsedText.length) : "";
    const tail: MarkdownStreamTail = isAppend ? markdownStreamTail(this.parsedText) : { kind: "none" };
    const claimableCode = tail.kind === "code" && this.findCodeFenceRenderer !== undefined && !this.streaming;
    if (isAppend && !claimableCode && canAppendMarkdownTail(tail, suffix)) {
      this.streamingSuffix = suffix;
      this.scheduleSettleParse();
    } else {
      this.commitMarkdown();
    }
    return html`<div class="formatted" dir="auto" @click=${this.onFormattedClick}></div>`;
  }

  override updated(changed: Map<PropertyKey, unknown>): void {
    const root = this.renderRoot.querySelector(".formatted");
    if (!(root instanceof HTMLElement)) throw new Error("Formatted Markdown root is unavailable");
    const mode: MarkdownDomUpdate = this.needsDomReset ? "replace" : this.streamingSuffix === "" ? "canonical" : "append";
    this.dom.commit(root, this.parsedHtml, mode, (target) => { this.enhanceCodeBlocks(target); });
    this.needsDomReset = false;
    if (!this.updateStreamingTail(root)) return;
    const claimsChanged = changed.has("findCodeFenceRenderer") || (changed.has("streaming") && !this.streaming);
    if (claimsChanged || this.streamingSuffix === "") this.reconcileClaimedFences();
  }

  private updateStreamingTail(root: HTMLElement): boolean {
    if (this.streamingSuffix === "") return true;
    if (this.dom.append(root, markdownStreamTail(this.parsedText), this.streamingSuffix)) return true;
    this.commitMarkdown();
    this.requestUpdate();
    return false;
  }

  private clearSettleTimer(): void {
    if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
  }

  private commitMarkdown(): void {
    this.clearSettleTimer();
    if (this.parsedText !== this.text) {
      this.parsedHtml = toSafeMarkdownHtml(this.text);
      this.parsedText = this.text;
    }
    this.streamingSuffix = "";
  }

  private scheduleSettleParse(): void {
    if (this.settleTimer !== undefined) return;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      if (this.parsedText === this.text) return;
      this.commitMarkdown();
      this.requestUpdate();
    }, STREAM_SETTLE_MS);
  }

  private enhanceCodeBlocks(root: ParentNode): void {
    root.querySelectorAll("pre").forEach((element) => {
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
      icon.innerHTML = COPY_MARK;
      button.append(icon);
      element.before(wrapper);
      wrapper.append(element, button);
    });
  }

  /**
   * A claimed fence draws the plugin's node above the source block, which
   * stays for copy and as the fallback: a renderer that throws, rejects or
   * answers with something that is not a Node leaves a readable code block,
   * never a hole. Claims are only taken on a settled parse - marked closes
   * an unterminated fence at end of input, so a streaming message would
   * otherwise hand the claimant a growing partial source several times a
   * second. Before mounting, the parse and the claimant are re-checked so a
   * re-parse in flight or a claim released mid-render cannot land a stale
   * drawing.
   */
  private renderClaimedFence(wrapper: HTMLElement, code: HTMLElement): void {
    if (this.streaming || this.streamingSuffix !== "") return;
    const lookup = this.findCodeFenceRenderer;
    if (lookup === undefined) return;
    const verdict = codeFenceVerdict(code.className, (language) => lookup(language) !== undefined);
    if (verdict.kind === "plain") return;
    const renderer = lookup(verdict.language);
    if (renderer === undefined) return;
    const previous = this.claimedBy.get(wrapper);
    if (previous?.phase === "pending" && previous.revision === this.sourceRevision && sameCodeFenceClaim(previous, lookup, verdict.language)) return;
    const parsedHtml = this.parsedHtml;
    const sourceText = this.text;
    const revision = this.sourceRevision;
    const source = code.textContent;
    const claim: CodeFenceClaim = { renderer, lookup, revision, phase: "pending" };
    wrapper.dataset["fenceLanguage"] = verdict.language;
    this.claimedBy.set(wrapper, claim);
    void Promise.resolve()
      .then(() => renderer.render(source))
      .then((node) => {
        if (this.sourceRevision !== revision || this.text !== sourceText || this.streamingSuffix !== "") return;
        if (this.parsedHtml !== parsedHtml || !wrapper.isConnected) return;
        if (this.claimedBy.get(wrapper) !== claim || !sameCodeFenceClaim(claim, this.findCodeFenceRenderer, verdict.language)) return;
        if (!(node instanceof Node)) throw new Error(`code fence renderer for ${verdict.language} returned ${typeof node}, not a Node`);
        wrapper.querySelector(":scope > .code-fence-render")?.remove();
        const drawing = document.createElement("div");
        drawing.className = "code-fence-render";
        drawing.dataset["language"] = verdict.language;
        drawing.append(node);
        wrapper.classList.add("code-fence-claimed");
        wrapper.prepend(drawing);
      })
      .catch((error: unknown) => {
        reportPluginFailure(renderer, renderer.id ?? `the ${verdict.language} code fence renderer`, "render", "the source block stays", error);
      })
      .finally(() => { claim.phase = "settled"; });
  }

  /**
   * The claim set moved under a settled transcript: a plugin registered after
   * the message drew, or was disposed while its drawing was on screen. Every
   * wrapped block is re-judged - a drawing with no claimant behind it comes
   * down, a newly claimable block goes up - so what is on screen never says
   * more than the registry does.
   */
  private reconcileClaimedFences(): void {
    this.renderRoot.querySelectorAll(".code-block-wrapper").forEach((wrapper) => {
      if (!(wrapper instanceof HTMLElement)) return;
      const code = wrapper.querySelector(":scope > pre > code");
      if (!(code instanceof HTMLElement)) return;
      const language = wrapper.dataset["fenceLanguage"];
      const stillClaimed = language !== undefined && sameCodeFenceClaim(this.claimedBy.get(wrapper), this.findCodeFenceRenderer, language);
      if (!stillClaimed) {
        this.claimedBy.delete(wrapper);
        wrapper.querySelector(":scope > .code-fence-render")?.remove();
        wrapper.classList.remove("code-fence-claimed");
        delete wrapper.dataset["fenceLanguage"];
      }
      if (!wrapper.classList.contains("code-fence-claimed")) this.renderClaimedFence(wrapper, code);
    });
  }

  private readonly onFormattedClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest(".code-copy-button");
    if (!(button instanceof HTMLButtonElement)) return;
    const wrapper = button.closest(".code-block-wrapper");
    if (!(wrapper instanceof HTMLElement)) return;
    const code = wrapper.querySelector(":scope > pre > code");
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
    if (icon !== null) icon.innerHTML = state === "copied" ? COPIED_MARK : COPY_MARK;
    const label = state === "copied" ? "Copied code block" : state === "failed" ? "Failed to copy code block" : "Copy code block";
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  static override styles = formattedTextStyles;
}
