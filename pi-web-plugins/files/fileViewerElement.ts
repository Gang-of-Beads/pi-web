import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { FileContentResponse } from "@gang-of-beads/pi-web/plugin-api";
import { adoptFilesHostStyles, filesRenderMarkdownHtml } from "./hostUi";
import type { WorkspaceFileViewMode, WorkspaceFileViewModeStore } from "./viewMode";
import { formatFileSize, workspaceFileName } from "./format";

export type WorkspaceFilePreviewKind = "image" | "html" | "pdf" | "markdown" | "audio" | "video" | "download" | "code";

export interface WorkspaceFileViewerIdentity {
  machineId: string;
  projectId: string;
  workspaceId: string;
  selectedPath: string | undefined;
  file: FileContentResponse | undefined;
}

export type FilesPreviewUrlBuilder = (path: string, options?: { modifiedAt?: string; download?: boolean }) => string;

@customElement("pi-files-viewer")
export class WorkspaceFileViewer extends LitElement {
  @property() machineId = "";
  @property() projectId = "";
  @property() workspaceId = "";
  @property() selectedPath: string | undefined;
  @property({ attribute: false }) file: FileContentResponse | undefined;
  @property({ attribute: false }) loadError: string | undefined;
  @property({ attribute: false }) previewUrlBuilder: FilesPreviewUrlBuilder | undefined;
  @property({ attribute: false }) modeStore: WorkspaceFileViewModeStore | undefined;
  @property({ attribute: false }) limits: { inlinePreviewBytes: number; streamPreviewBytes: number } = { inlinePreviewBytes: 10 * 1024 * 1024, streamPreviewBytes: 512 * 1024 * 1024 };

  /** Undefined until the first render adopts the deep-linked or stored mode. */
  private mode: WorkspaceFileViewMode | undefined;
  private publishedMode: WorkspaceFileViewMode | undefined;
  private activeFileKey: string | undefined;
  /**
   * Increments on every selected-file identity change. Rendered handlers carry
   * the token of the selection they belong to, so a delayed event from detached
   * markup can never affect a later selection — including when the user returns
   * to a file whose identity key is identical (A → B → A).
   */
  private selectionToken = 0;
  private failedPreviewToken: number | undefined;
  private readonly restoreModeFromHistory = (): void => {
    this.mode = this.modeStore?.adopt();
    // The restored entry owns the address-bar value. Forget the prior entry's
    // publication so this render can canonicalize a missing/invalid mode too.
    this.publishedMode = undefined;
    this.failedPreviewToken = undefined;
    this.requestUpdate();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("popstate", this.restoreModeFromHistory);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("popstate", this.restoreModeFromHistory);
    super.disconnectedCallback();
  }

  protected override willUpdate(): void {
    this.mode ??= this.modeStore?.adopt();
    const nextKey = this.currentFileKey();
    if (nextKey === this.activeFileKey) return;
    this.activeFileKey = nextKey;
    this.selectionToken += 1;
    // The mode deliberately survives a new selection; only failure state, which
    // belongs to the bytes that failed, is per selection.
    this.failedPreviewToken = undefined;
  }

  /**
   * Keep the address bar reproducible: whenever a file that actually has both
   * modes is on screen, the URL and the device preference name the mode being
   * shown, so copying the link reproduces this view for anyone who opens it.
   */
  protected override updated(): void {
    const mode = this.mode;
    if (mode === undefined || mode === this.publishedMode) return;
    if (!this.selectionHasRawAndPreviewModes()) return;
    this.publishedMode = mode;
    this.modeStore?.publish(mode);
  }

  override render(): TemplateResult {
    const selectedPath = this.selectedPath;
    if (selectedPath === undefined || selectedPath === "") return this.renderStatus("Select a file.");
    if (this.loadError !== undefined) return this.renderStatus(`Unable to load ${selectedPath}: ${this.loadError}`, true);

    const file = this.file;
    if (file === undefined) return this.renderStatus(`Loading ${selectedPath}…`);
    if (file.path !== selectedPath) {
      return this.renderStatus(`Unable to preview ${selectedPath}: loaded content belongs to ${file.path}.`, true);
    }

    const token = this.selectionToken;
    const kind = workspaceFilePreviewKind(file);
    const canOpen = isBrowserPreviewKind(kind) && file.size > 0 && file.size <= this.previewByteLimitForKind(kind);
    return html`
      ${this.renderViewerHeader(file, metadataForFile(file, kind), canOpen)}
      ${hasRawAndPreviewModes(file, kind) ? this.renderModeControls(file, token) : null}
      ${this.renderLoadedFile(file, kind, token)}
    `;
  }

  private renderLoadedFile(file: FileContentResponse, kind: WorkspaceFilePreviewKind, token: number): TemplateResult {
    if (hasRawAndPreviewModes(file, kind) && this.mode === "raw") return this.renderRawSource(file);
    if (file.size === 0) return this.renderStatus("This file is empty.");

    switch (kind) {
      case "image": return this.renderImagePreview(file, token);
      case "audio": return this.renderMediaPreview(file, "audio", token);
      case "video": return this.renderMediaPreview(file, "video", token);
      case "html": return this.renderFramePreview(file, "html", token);
      case "pdf": return this.renderFramePreview(file, "pdf", token);
      case "markdown": return this.renderMarkdownPreview(file);
      case "download": return this.renderUnsupportedFile(file);
      case "code": return this.renderRawSource(file);
    }
  }

  private renderViewerHeader(file: FileContentResponse, metadata: string, canOpen: boolean): TemplateResult {
    const name = workspaceFileName(file.path);
    const openUrl = this.previewUrl(file.path, { modifiedAt: file.modifiedAt });
    const downloadUrl = this.previewUrl(file.path, { modifiedAt: file.modifiedAt, download: true });
    return html`
      <div class="viewer-header">
        <strong title=${file.path}>${file.path}</strong>
        <div class="viewer-actions">
          <small>${metadata}</small>
          ${canOpen ? html`
            <a
              class="viewer-action"
              href=${openUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerpolicy="no-referrer"
              title="Open in new window"
            >Open ↗</a>
          ` : null}
          <a class="viewer-action" href=${downloadUrl} download=${name} title=${`Download ${name}`}>Download</a>
        </div>
      </div>
    `;
  }

  private renderModeControls(file: FileContentResponse, token: number): TemplateResult {
    return html`
      <div class="viewer-mode" role="group" aria-label=${`View ${file.path}`}>
        <button
          type="button"
          aria-pressed=${this.mode === "preview" ? "true" : "false"}
          @click=${() => { this.setMode("preview", token); }}
        >Preview</button>
        <button
          type="button"
          aria-pressed=${this.mode === "raw" ? "true" : "false"}
          @click=${() => { this.setMode("raw", token); }}
        >Raw</button>
      </div>
    `;
  }

  private renderRawSource(file: FileContentResponse): TemplateResult {
    if (file.size === 0) return this.renderStatus("This file is empty.");
    loadCodeViewer();
    return html`
      ${file.truncated ? html`<p class="preview-note" role="status">Raw source is truncated. Use Download for the complete file.</p>` : null}
      <pi-code-viewer .content=${file.content} .language=${file.language}></pi-code-viewer>
    `;
  }

  private renderMarkdownPreview(file: FileContentResponse): TemplateResult {
    if (file.size > this.limits.inlinePreviewBytes) return this.renderPreviewTooLarge(file, "markdown");
    try {
      const sanitized = filesRenderMarkdownHtml(file.content);
      return html`
        ${file.truncated ? html`<p class="preview-note" role="status">Preview is rendered from truncated source. Use Download for the complete file.</p>` : null}
        <div class="formatted markdown-preview" dir="auto">${unsafeHTML(sanitized)}</div>
      `;
    } catch {
      return this.renderStatus("Markdown preview failed. Use Raw or Download instead.", true);
    }
  }

  private renderImagePreview(file: FileContentResponse, token: number): TemplateResult {
    if (file.size > this.limits.inlinePreviewBytes) return this.renderPreviewTooLarge(file, "image");
    if (this.failedPreviewToken === token) return this.renderPreviewFailure(file, token);
    const src = this.previewUrl(file.path, { modifiedAt: file.modifiedAt });
    return html`
      <div class="image-preview">
        <img
          src=${src}
          alt=${`Preview of ${file.path}`}
          decoding="async"
          referrerpolicy="no-referrer"
          @error=${() => { this.recordPreviewFailure(token); }}
        />
      </div>
    `;
  }

  /**
   * Audio and video play through the browser's own media elements against the
   * streaming preview route, which answers range requests, so seeking does not
   * refetch the file. A codec the browser lacks surfaces as a media error and
   * lands in the same failure state as a broken image, where Open ↗ and
   * Download stay available.
   */
  private renderMediaPreview(file: FileContentResponse, kind: "audio" | "video", token: number): TemplateResult {
    if (file.size > this.previewByteLimitForKind(kind)) return this.renderPreviewTooLarge(file, kind);
    if (this.failedPreviewToken === token) return this.renderPreviewFailure(file, token);
    const src = this.previewUrl(file.path, { modifiedAt: file.modifiedAt });
    const onError = () => { this.recordPreviewFailure(token); };
    // `preload="metadata"` keeps the first paint cheap on a long clip: the
    // browser fetches only what it needs to report duration and size.
    if (kind === "audio") {
      return html`
        <div class="media-preview">
          <audio controls preload="metadata" src=${src} referrerpolicy="no-referrer" @error=${onError}>Your browser cannot play this audio file.</audio>
        </div>
      `;
    }
    return html`
      <div class="media-preview">
        <video controls playsinline preload="metadata" src=${src} referrerpolicy="no-referrer" @error=${onError}>Your browser cannot play this video file.</video>
      </div>
    `;
  }

  private renderFramePreview(file: FileContentResponse, kind: "html" | "pdf", token: number): TemplateResult {
    if (file.size > this.limits.inlinePreviewBytes) return this.renderPreviewTooLarge(file, kind);
    if (this.failedPreviewToken === token) return this.renderPreviewFailure(file, token);
    const src = this.previewUrl(file.path, { modifiedAt: file.modifiedAt });

    return html`
      ${kind === "pdf" ? html`<p class="preview-note" role="status">Inline PDF support varies by browser. Use Open ↗ or Download above if the document does not appear.</p>` : null}
      <iframe
        class="file-frame-preview"
        src=${src}
        sandbox=${ifDefined(framePreviewSandbox(kind))}
        allow=""
        referrerpolicy="no-referrer"
        title=${`Preview of ${file.path}`}
        @error=${() => { this.recordPreviewFailure(token); }}
      ></iframe>
    `;
  }

  private renderPreviewFailure(file: FileContentResponse, token: number): TemplateResult {
    return html`
      <div class="preview-state" role="alert">
        <strong>Preview failed for ${file.path}.</strong>
        <span>Open it in a new window or use Download above.</span>
        <button type="button" @click=${() => { this.retryPreview(token); }}>Retry preview</button>
      </div>
    `;
  }

  private renderUnsupportedFile(file: FileContentResponse): TemplateResult {
    const name = workspaceFileName(file.path);
    const href = this.previewUrl(file.path, { modifiedAt: file.modifiedAt, download: true });
    return html`
      <div class="preview-state">
        <p>Preview isn't available for this file type.</p>
        <a class="download-link" href=${href} download=${name}>Download ${name} · ${formatFileSize(file.size)}</a>
      </div>
    `;
  }

  private renderPreviewTooLarge(file: FileContentResponse, kind: WorkspaceFilePreviewKind): TemplateResult {
    const label = formatFileSize(isStreamPreviewKind(kind) ? this.limits.streamPreviewBytes : this.limits.inlinePreviewBytes);
    return this.renderStatus(`File too large to preview: ${formatFileSize(file.size)} · limit ${label}. Use Download above.`);
  }

  private renderStatus(message: string, alert = false): TemplateResult {
    return alert
      ? html`<p class="viewer-status" role="alert">${message}</p>`
      : html`<p class="viewer-status" role="status" aria-live="polite">${message}</p>`;
  }

  private previewByteLimitForKind(kind: WorkspaceFilePreviewKind): number {
    return isStreamPreviewKind(kind) ? this.limits.streamPreviewBytes : this.limits.inlinePreviewBytes;
  }

  private previewUrl(path: string, options?: { modifiedAt?: string; download?: boolean }): string {
    return this.previewUrlBuilder?.(path, options) ?? "";
  }

  private setMode(mode: WorkspaceFileViewMode, token: number): void {
    if (token !== this.selectionToken) return;
    this.mode = mode;
    this.failedPreviewToken = undefined;
    this.requestUpdate();
  }

  private recordPreviewFailure(token: number): void {
    // Streamed kinds (raster images, PDF) have no raw form and always show an
    // embedded preview, so the guard asks what is on screen rather than what
    // the remembered mode says.
    if (token !== this.selectionToken || this.showsRawSource()) return;
    this.failedPreviewToken = token;
    this.requestUpdate();
  }

  private retryPreview(token: number): void {
    if (token !== this.selectionToken) return;
    this.failedPreviewToken = undefined;
    this.requestUpdate();
  }

  private currentFileKey(): string {
    return workspaceFileViewerIdentityKey(this);
  }

  private showsRawSource(): boolean {
    return this.mode === "raw" && this.selectionHasRawAndPreviewModes();
  }

  private selectionHasRawAndPreviewModes(): boolean {
    const file = this.file;
    if (file === undefined || this.loadError !== undefined) return false;
    if (this.selectedPath === undefined || file.path !== this.selectedPath) return false;
    return hasRawAndPreviewModes(file, workspaceFilePreviewKind(file));
  }

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) adoptFilesHostStyles(root);
    return root;
  }

  static override styles = [
    css`
    :host { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: auto; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui, system-ui, sans-serif); }
    .viewer-header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-4); border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
    .viewer-header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .viewer-actions { display: flex; align-items: center; gap: var(--pi-space-4); flex: 0 0 auto; }
    small { color: var(--pi-muted); }
    .viewer-action, .download-link { flex: 0 0 auto; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-sm); background: var(--pi-surface); color: var(--pi-text); text-decoration: none; white-space: nowrap; }
    .viewer-action { padding: var(--pi-space-2) var(--pi-space-4); font-size: var(--pi-text-xs); }
    @media (hover: hover) { .viewer-action:hover, .download-link:hover { border-color: var(--pi-border); background: var(--pi-bg); } }
    .viewer-mode { flex: 0 0 auto; display: flex; justify-content: flex-end; gap: var(--pi-space-2); padding: var(--pi-space-3) var(--pi-space-4); border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
    .viewer-mode button, .preview-state button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-2) var(--pi-space-5); cursor: pointer; font: inherit; }
    .viewer-mode button { font-size: var(--pi-text-xs); }
    .viewer-mode button[aria-pressed="true"] { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .viewer-mode button:focus-visible, .preview-state button:focus-visible, a:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    pi-code-viewer { flex: 1 1 auto; min-height: 0; }
    .markdown-preview { flex: 1 1 auto; min-height: 0; box-sizing: border-box; overflow: auto; padding: var(--pi-space-7); }
    .preview-note { flex: 0 0 auto; margin: 0; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-surface); color: var(--pi-muted); padding: var(--pi-space-4) var(--pi-space-5); font-size: var(--pi-text-xs); }
    .image-preview { flex: 1 1 auto; min-height: 0; box-sizing: border-box; display: flex; align-items: center; justify-content: center; overflow: auto; padding: var(--pi-space-7); }
    .image-preview img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-md); background-color: var(--pi-surface); background-image: linear-gradient(45deg, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 25%, transparent 25%), linear-gradient(-45deg, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 75%), linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; box-shadow: var(--pi-elevation-2); }
    .file-frame-preview { box-sizing: border-box; flex: 1 1 auto; min-height: 0; width: 100%; border: none; background: var(--pi-surface); }
    .media-preview { flex: 1 1 auto; min-height: 0; box-sizing: border-box; display: flex; align-items: center; justify-content: center; overflow: auto; padding: var(--pi-space-7); }
    .media-preview video { display: block; max-width: 100%; max-height: 100%; border-radius: var(--pi-radius-md); background: #000; }
    .media-preview audio { width: min(100%, 480px); }
    .viewer-status { box-sizing: border-box; margin: auto; max-width: 100%; color: var(--pi-muted); padding: var(--pi-space-8); text-align: center; overflow-wrap: anywhere; }
    .preview-state { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--pi-space-6); box-sizing: border-box; padding: var(--pi-space-9); color: var(--pi-muted); text-align: center; }
    .preview-state strong { color: var(--pi-text); }
    .preview-state p { margin: 0; }
    .download-link { display: inline-block; padding: var(--pi-space-4) var(--pi-space-7); font-size: var(--pi-text-sm); }
    @media (max-width: 640px) {
      .viewer-header { align-items: flex-start; flex-direction: column; }
      .viewer-actions { width: 100%; flex-wrap: wrap; }
    }
  `];
}

/** Stable state key for mode and embedded-preview failure ownership. */
export function workspaceFileViewerIdentityKey(identity: WorkspaceFileViewerIdentity): string {
  return JSON.stringify([
    identity.machineId,
    identity.projectId,
    identity.workspaceId,
    identity.selectedPath ?? null,
    identity.file?.path ?? null,
    identity.file?.modifiedAt ?? null,
    identity.file?.mediaType ?? null,
  ]);
}

export function workspaceFilePreviewKind(file: FileContentResponse): WorkspaceFilePreviewKind {
  if (file.mediaType === "image") return "image";
  if (file.mediaType === "html") return "html";
  if (file.mediaType === "pdf") return "pdf";
  if (file.mediaType === "markdown") return "markdown";
  if (file.mediaType === "audio") return "audio";
  if (file.mediaType === "video") return "video";
  if (file.binary) return "download";
  return "code";
}

/** Media kinds are streamed and range-serviced, so they carry a larger limit. */
function isStreamPreviewKind(kind: WorkspaceFilePreviewKind): boolean {
  return kind === "audio" || kind === "video";
}

/**
 * Both modes exist when the file has a rendered preview and its JSON read
 * carried literal source: HTML, Markdown, and text-based images such as SVG.
 * Streamed formats (raster images, PDF) have no source to show, and plain code
 * files have no rendered form.
 */
function hasRawAndPreviewModes(file: FileContentResponse, kind: WorkspaceFilePreviewKind): boolean {
  return kind !== "code" && kind !== "download" && !file.binary;
}

/**
 * HTML previews stay fully sandboxed: opaque origin, no scripts, no forms, no
 * navigation, matching the server's `sandbox` CSP.
 *
 * PDF previews intentionally carry no sandbox attribute (`undefined` omits it).
 * Sandboxed frames refuse native PDF handlers — Chromium renders nothing
 * (crbug.com/41131921, whatwg/html#3958) and Firefox 134+ downloads the file
 * instead of displaying it (bugzilla 1724924, 1941725) — so a sandboxed frame
 * produces a blank pane or a surprise download rather than a preview. The
 * isolation that matters for PDF is the response contract: the server sends
 * `application/pdf` with `X-Content-Type-Options: nosniff` and a
 * `default-src 'none'` CSP, so those bytes can only reach the browser's PDF
 * handler, can never be interpreted as an active same-origin document, and
 * cannot load subresources or run script in the PI WEB origin. `allow=""` and
 * `referrerpolicy="no-referrer"` still deny delegated capabilities and referrer
 * leakage, and a persistent Open/Download affordance covers browsers that
 * decline to display PDFs inline at all.
 */
function framePreviewSandbox(kind: "html" | "pdf"): string | undefined {
  return kind === "html" ? "" : undefined;
}

function isBrowserPreviewKind(kind: WorkspaceFilePreviewKind): kind is "image" | "html" | "pdf" | "audio" | "video" {
  return kind === "image" || kind === "html" || kind === "pdf" || kind === "audio" || kind === "video";
}

function metadataForFile(file: FileContentResponse, kind: WorkspaceFilePreviewKind): string {
  const format = kind === "code"
    ? file.language ?? "text"
    : kind === "download"
      ? file.mimeType ?? "binary"
      : kind === "markdown"
        ? "markdown"
        : file.mimeType ?? kind;
  return `${format} · ${formatFileSize(file.size)}${file.truncated ? " · truncated" : ""}`;
}

function loadCodeViewer(): void {
  void import("./codeViewerElement");
}
