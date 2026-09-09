import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { FileTreeEntry, WorkspacePanelContext, WorkspaceUploadBatchProgress } from "@gang-of-beads/pi-web/plugin-api";
import { adoptFilesHostStyles, describeFilesError, filesQuery, filesRegisterModal } from "./hostUi";
import { createStore } from "./viewMode";
import { FilesExplorer, explorerIdentityKey } from "./explorer";
import { createWorkspaceUploadBatchState, cancelWorkspaceUploadBatch, completeWorkspaceUploadBatch, failWorkspaceUploadBatch, updateWorkspaceUploadBatchProgress, type WorkspaceUploadBatchState, type WorkspaceUploadFileState } from "./uploadBatches";
import { workspaceUploadPath } from "./uploadPaths";
import { filesSplitClass } from "./filesSplitLayout";
import { formatFileSize } from "./format";
import "./fileViewerElement";

interface PendingWorkspaceUploadReview {
  files: File[];
}

interface WorkspaceUploadBatchErrorShape {
  readonly failures: readonly { path: string; error: string }[];
  readonly responses: readonly { path: string }[];
}

/** Mark the live panel's tree stale after a session turn settled. */
export function markFilesPanelStale(): void {
  PiFilesPanel.active?.markStale();
}

/** Ask the live panel to refetch; the host calls this on panel invalidation. */
export function invalidateFilesPanel(): void {
  const panel = PiFilesPanel.active;
  if (panel !== undefined) panel.refresh();
}

@customElement("pi-files-panel")
export class PiFilesPanel extends LitElement {
  /** The one panel instance rendering right now; the host talks to it through the module functions. */
  static active: PiFilesPanel | undefined;
  @property({ attribute: false }) context: WorkspacePanelContext | undefined;
  @query("#workspace-upload-input") private uploadInput?: HTMLInputElement;
  @query(".dialog-backdrop") private uploadDialogBackdrop?: HTMLElement | null;
  @query(".upload-dialog") private uploadDialog?: HTMLElement | null;
  @state() private pendingUpload: PendingWorkspaceUploadReview | undefined;
  @state() private destinationFolder = "";
  @state() private overwrite = false;
  @state() private createDirs = true;
  @state() private formError = "";
  @state() private dragActive = false;
  @state() private batches: Record<string, WorkspaceUploadBatchState> = {};
  private dragDepth = 0;
  private uploadModalRegistration: { readonly isTop: boolean; focus(): boolean; unregister(): void } | undefined;
  private uploadBatchSequence = 0;
  private explorer: FilesExplorer | undefined;
  private explorerIdentityKey = "";

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    if (!changedProperties.has("context")) return;
    const context = this.context;
    if (context === undefined) return;
    if (this.explorer === undefined || explorerIdentityKey(this.explorer.currentIdentity) !== this.contextKey(context)) {
      this.resetForContext(context);
    }
  }

  protected override updated(): void {
    this.syncUploadModal();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    PiFilesPanel.active = this;
  }

  override disconnectedCallback(): void {
    if (PiFilesPanel.active === this) PiFilesPanel.active = undefined;
    this.releaseUploadModal();
    super.disconnectedCallback();
  }

  markStale(): void {
    this.explorer?.markStale();
  }

  refresh(): void {
    void this.explorer?.refresh();
  }

  override render(): TemplateResult {
    const context = this.context;
    const explorer = this.explorer;
    if (context === undefined || explorer === undefined) return html`<p class="muted">Files unavailable.</p>`;
    const state = explorer.state;
    return html`
      <section
        class=${this.dragActive ? "files-panel dragging" : "files-panel"}
        @dragenter=${this.handleDragEnter}
        @dragover=${this.handleDragOver}
        @dragleave=${this.handleDragLeave}
        @drop=${this.handleDrop}
      >
        <section class="toolbar">
          <strong>Files</strong>
          ${state.stale ? html`<span class="stale">stale</span>` : null}
          <div class="toolbar-actions">
            <button @click=${this.openFilePicker}>Upload</button>
            <button @click=${() => { void explorer.refresh(); }}>Refresh</button>
          </div>
          <input id="workspace-upload-input" class="visually-hidden" type="file" multiple @change=${this.handleFileInputChange} />
        </section>
        ${this.renderUploadProgress()}
        <section class=${filesSplitClass(state.selectedFilePath)}>
          <div class="list tree">
            ${state.tree.length === 0
              ? state.treeFailed === undefined
                ? html`<p class="muted">No files loaded.</p>`
                : html`<p class="muted tree-failed" role="alert">Couldn't read this workspace's files: ${state.treeFailed}</p>`
              : state.tree.map((entry) => this.renderTreeEntry(explorer, entry, 0))}
          </div>
          <div class="viewer">
            <pi-files-viewer
              .machineId=${context.machine.id}
              .projectId=${context.workspace.projectId}
              .workspaceId=${context.workspace.id}
              .selectedPath=${state.selectedFilePath}
              .file=${state.selectedFileContent}
              .loadError=${state.selectedFileLoadError}
              .previewUrlBuilder=${(path: string, options?: { modifiedAt?: string; download?: boolean }) => context.files.previewUrl(path, options)}
              .modeStore=${this.modeStore()}
              .limits=${context.files.limits}
            ></pi-files-viewer>
          </div>
        </section>
        <div class="drop-overlay" aria-hidden=${this.dragActive ? "false" : "true"}>
          <div>
            <strong>Drop files to upload</strong>
            <span>Uploads immediately to the default folder.</span>
          </div>
        </div>
        ${this.pendingUpload === undefined ? null : this.renderUploadDialog(context, this.pendingUpload)}
      </section>
    `;
  }

  private renderTreeEntry(explorer: FilesExplorer, entry: FileTreeEntry, depth: number): TemplateResult {
    const children = explorer.state.expandedDirs[entry.path];
    const hasChildren = children !== undefined;
    const selected = entry.type !== "directory" && explorer.state.selectedFilePath === entry.path;
    return html`
      <button class=${selected ? "row selected" : "row"} style=${`--depth:${String(depth)}`} @click=${() => { this.selectTreeEntry(explorer, entry); }}>
        <span>${entry.type === "directory" ? (hasChildren ? "▾" : "▸") : "·"}</span>
        <span>${entry.name}</span>
      </button>
      ${hasChildren ? children.map((child) => this.renderTreeEntry(explorer, child, depth + 1)) : null}
    `;
  }

  private selectTreeEntry(explorer: FilesExplorer, entry: FileTreeEntry): void {
    if (entry.type === "directory") void explorer.expandDir(entry.path);
    else explorer.selectFile(entry.path);
  }

  private renderUploadProgress(): TemplateResult | null {
    const batches = Object.values(this.batches).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    if (batches.length === 0) return null;
    return html`
      <section class="upload-progress" aria-label="Workspace uploads">
        <div class="upload-progress-header">
          <strong>Uploads</strong>
          <small>${uploadSummaryLabel(batches)}</small>
        </div>
        ${batches.map((batch) => this.renderUploadBatch(batch))}
      </section>
    `;
  }

  private renderUploadBatch(batch: WorkspaceUploadBatchState): TemplateResult {
    return html`
      <article class=${`upload-batch ${batch.status}`}>
        <div class="upload-batch-heading">
          <div>
            <strong>${uploadBatchTitle(batch)}</strong>
            <small>${batch.destinationFolder === "" ? "workspace root" : batch.destinationFolder}</small>
          </div>
          <span>${uploadBatchStatusLabel(batch)}</span>
        </div>
        <progress max="1" .value=${uploadBatchProgressValue(batch)}></progress>
        <div class="upload-file-list">
          ${batch.files.map((file) => this.renderUploadFile(file))}
        </div>
        <div class="upload-actions">
          ${batch.status === "uploading" ? html`<button @click=${() => { this.cancelUpload(batch.id); }}>Cancel</button>` : html`<button @click=${() => { this.clearUpload(batch.id); }}>Dismiss</button>`}
        </div>
      </article>
    `;
  }

  private renderUploadFile(file: WorkspaceUploadFileState): TemplateResult {
    const detail = uploadFileDetail(file);
    return html`
      <div class=${`upload-file ${file.status}`}>
        <div class="upload-file-main">
          <span>${file.name}</span>
          <small>${detail}</small>
        </div>
        <span class="upload-file-status">${uploadFileStatusLabel(file)}</span>
      </div>
    `;
  }

  private renderUploadDialog(context: WorkspacePanelContext, review: PendingWorkspaceUploadReview): TemplateResult {
    const fileCount = review.files.length;
    return html`
      <div class="dialog-backdrop" @mousedown=${() => { this.closeUploadDialog(); }}>
        <section class="upload-dialog" role="dialog" aria-modal="true" aria-label="Review file upload" tabindex="-1" @mousedown=${(event: MouseEvent) => { event.stopPropagation(); }} @keydown=${this.handleDialogKeyDown}>
          <header>
            <div>
              <span class="eyebrow">Upload</span>
              <h2>Review ${fileCount === 1 ? "file" : `${String(fileCount)} files`}</h2>
            </div>
            <button class="close-button" title="Cancel upload" aria-label="Cancel upload" @click=${() => { this.closeUploadDialog(); }}>×</button>
          </header>
          <form @submit=${(event: SubmitEvent) => { this.submitUploadReview(event, context, review); }}>
            <label>
              <span>Destination folder</span>
              <input id="workspace-upload-destination" .value=${this.destinationFolder} placeholder=${context.files.uploadFolder} @input=${this.handleDestinationInput} />
              <small>Workspace-relative. Leave empty to upload at the workspace root.</small>
            </label>
            <div class="dialog-options">
              <label>
                <input type="checkbox" .checked=${this.createDirs} @change=${this.handleCreateDirsChange} />
                <span>Create parent folders</span>
              </label>
              <label>
                <input type="checkbox" .checked=${this.overwrite} @change=${this.handleOverwriteChange} />
                <span>Overwrite existing files</span>
              </label>
            </div>
            <section class="review-files" aria-label="Files to upload">
              <strong>${fileCount === 1 ? "File" : "Files"}</strong>
              ${review.files.map((file) => html`
                <div class="review-file">
                  <span>${file.name}</span>
                  <small>${formatFileSize(file.size)}</small>
                </div>
              `)}
            </section>
            ${this.formError === "" ? null : html`<div class="dialog-error" role="alert">${this.formError}</div>`}
            <footer>
              <button type="button" @click=${() => { this.closeUploadDialog(); }}>Cancel</button>
              <button type="submit">Upload</button>
            </footer>
          </form>
        </section>
      </div>
    `;
  }

  private readonly openFilePicker = (): void => {
    this.uploadInput?.click();
  };

  private readonly handleFileInputChange = (event: Event): void => {
    const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : undefined;
    const files = fileListToArray(input?.files);
    if (input !== undefined) input.value = "";
    if (files.length > 0) this.openUploadReview(files);
  };

  private readonly handleDragEnter = (event: DragEvent): void => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth += 1;
    this.dragActive = true;
  };

  private readonly handleDragOver = (event: DragEvent): void => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
    this.dragActive = true;
  };

  private readonly handleDragLeave = (event: DragEvent): void => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.dragActive = false;
  };

  private readonly handleDrop = (event: DragEvent): void => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.dragActive = false;
    const files = fileListToArray(event.dataTransfer?.files);
    if (files.length > 0) this.startUpload(files, { destinationFolder: this.context?.files.uploadFolder ?? "", createDirs: true, overwrite: false, selectUploadedFile: true });
  };

  private readonly handleDestinationInput = (event: Event): void => {
    const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : undefined;
    this.destinationFolder = input?.value ?? "";
    this.formError = "";
  };

  private readonly handleCreateDirsChange = (event: Event): void => {
    const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : undefined;
    this.createDirs = input?.checked ?? true;
  };

  private readonly handleOverwriteChange = (event: Event): void => {
    const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : undefined;
    this.overwrite = input?.checked ?? false;
  };

  private readonly handleDialogKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    this.closeUploadDialog();
  };

  private openUploadReview(files: File[]): void {
    this.pendingUpload = { files };
    this.destinationFolder = this.context?.files.uploadFolder ?? "";
    this.overwrite = false;
    this.createDirs = true;
    this.formError = "";
  }

  private submitUploadReview(event: SubmitEvent, context: WorkspacePanelContext, review: PendingWorkspaceUploadReview): void {
    event.preventDefault();
    const validationError = workspaceUploadReviewError(review.files, this.destinationFolder);
    if (validationError !== undefined) {
      this.formError = validationError;
      return;
    }
    this.startUpload(review.files, {
      destinationFolder: this.destinationFolder,
      createDirs: this.createDirs,
      overwrite: this.overwrite,
      selectUploadedFile: true,
    });
    this.closeUploadDialog();
  }

  private closeUploadDialog(): void {
    this.pendingUpload = undefined;
    this.formError = "";
  }

  private startUpload(files: readonly File[], options: { destinationFolder: string; createDirs: boolean; overwrite: boolean; selectUploadedFile: boolean }): void {
    const context = this.context;
    const explorer = this.explorer;
    if (context === undefined || explorer === undefined || files.length === 0) return;
    this.uploadBatchSequence += 1;
    const batchId = `workspace-upload-${String(this.uploadBatchSequence)}`;
    let batch: WorkspaceUploadBatchState;
    try {
      batch = createWorkspaceUploadBatchState({
        id: batchId,
        workspaceId: context.workspace.id,
        destinationFolder: options.destinationFolder,
        files,
        startedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.formError = describeFilesError(error);
      return;
    }
    this.batches = { ...this.batches, [batch.id]: batch };
    const task = context.files.uploadFiles(files, {
      destinationFolder: options.destinationFolder,
      createDirs: options.createDirs,
      overwrite: options.overwrite,
      onProgress: (progress) => { this.updateBatchProgress(batch.id, progress); },
    });
    void task.promise
      .then(async (responses) => {
        this.completeBatch(batch.id, responses);
        await explorer.refresh();
        const uploadedPath = responses[0]?.path;
        if (options.selectUploadedFile && uploadedPath !== undefined) explorer.selectFile(uploadedPath);
      })
      .catch(async (error: unknown) => {
        this.failBatch(batch.id, error);
        if (batchErrorResponse(error) === undefined) return;
        await explorer.refresh();
      });
  }

  private cancelUpload(batchId: string): void {
    const batch = this.batches[batchId];
    if (batch?.status !== "uploading") return;
    this.batches = { ...this.batches, [batchId]: cancelWorkspaceUploadBatch(batch, new Date().toISOString()) };
  }

  private clearUpload(batchId: string): void {
    this.batches = Object.fromEntries(Object.entries(this.batches).filter(([id]) => id !== batchId));
  }

  private updateBatchProgress(batchId: string, progress: WorkspaceUploadBatchProgress): void {
    const batch = this.batches[batchId];
    if (batch?.status !== "uploading") return;
    this.batches = { ...this.batches, [batchId]: updateWorkspaceUploadBatchProgress(batch, progress) };
  }

  private completeBatch(batchId: string, responses: Parameters<typeof completeWorkspaceUploadBatch>[1]): void {
    const batch = this.batches[batchId];
    if (batch?.status !== "uploading") return;
    this.batches = { ...this.batches, [batchId]: completeWorkspaceUploadBatch(batch, responses, new Date().toISOString()) };
  }

  private failBatch(batchId: string, error: unknown): void {
    const batch = this.batches[batchId];
    if (batch?.status !== "uploading") return;
    if (isUploadCancelled(error)) {
      this.batches = { ...this.batches, [batchId]: cancelWorkspaceUploadBatch(batch, new Date().toISOString()) };
      return;
    }
    const message = describeFilesError(error);
    this.batches = { ...this.batches, [batchId]: failWorkspaceUploadBatch(batch, message, new Date().toISOString()) };
  }

  private syncUploadModal(): void {
    const backdrop = this.uploadDialogBackdrop;
    const dialog = this.uploadDialog;
    if (!(backdrop instanceof HTMLElement) || !(dialog instanceof HTMLElement)) {
      this.releaseUploadModal();
      return;
    }
    if (this.uploadModalRegistration !== undefined) {
      this.applyUploadModalAccessibility(dialog, this.uploadModalRegistration.isTop);
      return;
    }

    const registration = filesRegisterModal({
      element: backdrop,
      // The workspace panel establishes the outer stacking context. Its
      // internal z-index cannot outrank a fixed application dialog outside it.
      paintElement: workspaceModalLayerHost(this),
      focus: () => {
        const destination = this.renderRoot.querySelector<HTMLElement>("#workspace-upload-destination");
        (destination ?? dialog).focus();
      },
      onTopChange: (isTop) => { this.applyUploadModalAccessibility(dialog, isTop); },
    });
    if (registration === undefined) return;
    this.uploadModalRegistration = registration;
    registration.focus();
  }

  private applyUploadModalAccessibility(dialog: HTMLElement, isTop: boolean): void {
    dialog.setAttribute("aria-modal", isTop ? "true" : "false");
    if (isTop) dialog.removeAttribute("aria-hidden");
    else dialog.setAttribute("aria-hidden", "true");
  }

  private releaseUploadModal(): void {
    const registration = this.uploadModalRegistration;
    this.uploadModalRegistration = undefined;
    registration?.unregister();
  }

  private resetForContext(context: WorkspacePanelContext): void {
    const query = filesQuery();
    const explorer = new FilesExplorer({
      listFiles: (path) => context.files.listFiles(path),
      readFile: (path) => context.files.readFile(path),
      writeSelectionToUrl: (path) => { query?.write(FILES_ROUTE_NAMESPACE, SELECTION_QUERY_KEY, path, { replace: true }); },
      readSelectionFromUrl: () => query?.read(FILES_ROUTE_NAMESPACE, SELECTION_QUERY_KEY),
      describeError: describeFilesError,
      onChange: () => { this.requestUpdate(); },
    });
    this.explorer = explorer;
    this.explorerIdentityKey = this.contextKey(context);
    this.batches = {};
    this.closeUploadDialog();
    this.dragDepth = 0;
    this.dragActive = false;
    explorer.adopt({ machineId: context.machine.id, projectId: context.workspace.projectId, workspaceId: context.workspace.id });
  }

  private contextKey(context: WorkspacePanelContext): string {
    return `${context.machine.id}:${context.workspace.projectId}:${context.workspace.id}`;
  }

  private modeStore(): ReturnType<typeof createStore> | undefined {
    const query = filesQuery();
    return query === undefined ? undefined : createStore({ query });
  }

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) adoptFilesHostStyles(root);
    return root;
  }

  static override styles = [
    css`
      :host { flex: 1 1 auto; }
      pi-files-viewer { flex: 1 1 auto; min-height: 0; }
      .files-panel { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
      .toolbar-actions { display: flex; align-items: center; gap: var(--pi-space-4); margin-left: auto; }
      .toolbar .toolbar-actions button { margin-left: 0; }
      .visually-hidden { box-sizing: border-box; position: absolute; width: 1px; height: 1px; padding: 0; margin: calc(-1 * var(--pi-space-1)); overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
      .drop-overlay { position: absolute; inset: 52px 10px 10px; z-index: var(--pi-layer-raised); display: grid; place-items: center; border: 2px dashed var(--pi-accent); border-radius: var(--pi-radius-lg); background: color-mix(in srgb, var(--pi-bg-overlay) 90%, var(--pi-accent) 10%); color: var(--pi-text); opacity: 0; pointer-events: none; transition: opacity .12s ease; }
      .files-panel.dragging .drop-overlay { opacity: 1; }
      .drop-overlay div { display: grid; gap: var(--pi-space-2); justify-items: center; padding: var(--pi-space-8); border-radius: var(--pi-radius-lg); background: var(--pi-bg-overlay); box-shadow: var(--pi-elevation-2); }
      .drop-overlay span { color: var(--pi-muted); }
      .upload-progress { flex: 0 0 auto; display: grid; gap: var(--pi-space-4); padding: var(--pi-space-4); border-bottom: 1px solid var(--pi-border-muted); background: color-mix(in srgb, var(--pi-surface) 55%, transparent); }
      .upload-progress-header, .upload-batch-heading, .upload-actions { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); }
      .upload-batch { display: grid; gap: var(--pi-space-3); border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-md); background: var(--pi-bg); padding: var(--pi-space-4); }
      .upload-batch.error { border-color: var(--pi-danger); }
      .upload-batch.cancelled { border-color: var(--pi-warning-border); }
      .upload-batch.completed { border-color: var(--pi-success-border); }
      .upload-batch-heading > div { min-width: 0; display: grid; gap: var(--pi-space-1); }
      .upload-batch-heading strong, .upload-batch-heading small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      progress { width: 100%; accent-color: var(--pi-accent); }
      .upload-file-list { display: grid; gap: var(--pi-space-2); max-height: 180px; overflow: auto; padding-right: var(--pi-space-1); }
      .upload-file { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--pi-space-4); color: var(--pi-muted); }
      .upload-file.completed .upload-file-status { color: var(--pi-success); }
      .upload-file.error { color: var(--pi-danger); }
      .upload-file.cancelled .upload-file-status { color: var(--pi-warning); }
      .upload-file-main { min-width: 0; display: grid; gap: var(--pi-space-1); }
      .upload-file-main span, .upload-file-main small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .upload-file-status { font-size: var(--pi-text-xs); white-space: nowrap; }
      .upload-actions { justify-content: end; }
      .dialog-backdrop { position: fixed; inset: 0; z-index: var(--pi-layer-popover); box-sizing: border-box; display: grid; place-items: center; padding: max(var(--pi-space-8), env(safe-area-inset-top)) max(var(--pi-space-8), env(safe-area-inset-right)) max(var(--pi-space-8), env(safe-area-inset-bottom)) max(var(--pi-space-8), env(safe-area-inset-left)); background: var(--pi-overlay); }
      .upload-dialog { box-sizing: border-box; width: min(560px, 100%); max-height: min(720px, 100%); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-bg); box-shadow: var(--pi-elevation-3); }
      .upload-dialog header { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-6); padding: var(--pi-space-7) var(--pi-space-7); border-bottom: 1px solid var(--pi-border-muted); }
      .upload-dialog h2 { margin: var(--pi-space-1) 0 0; font-size: var(--pi-text-lg); line-height: 1.2; }
      .eyebrow { color: var(--pi-muted); font-size: var(--pi-text-2xs); letter-spacing: .08em; text-transform: uppercase; }
      .close-button { font-size: var(--pi-text-xl); line-height: 1; padding: var(--pi-space-2) var(--pi-space-5); }
      form { min-height: 0; display: flex; flex-direction: column; gap: var(--pi-space-6); overflow: auto; padding: var(--pi-space-7); }
      form > label { display: grid; gap: var(--pi-space-3); }
      form > label > span, .review-files > strong { font-weight: var(--pi-weight-semibold); }
      input[type="text"], form > label > input:not([type]) { box-sizing: border-box; width: 100%; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
      input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
      .dialog-options { display: grid; gap: var(--pi-space-4); }
      .dialog-options label { display: flex; align-items: center; gap: var(--pi-space-4); color: var(--pi-text); }
      .review-files { display: grid; gap: var(--pi-space-3); min-height: 0; max-height: 180px; overflow: auto; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-md); padding: var(--pi-space-4); }
      .review-file { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--pi-space-4); align-items: baseline; }
      .review-file span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dialog-error { border: 1px solid var(--pi-danger); border-radius: var(--pi-radius-md); background: color-mix(in srgb, var(--pi-danger) 10%, transparent); color: var(--pi-danger); padding: var(--pi-space-5); line-height: 1.35; overflow-wrap: anywhere; }
      footer { display: flex; justify-content: flex-end; gap: var(--pi-space-4); padding-top: var(--pi-space-2); }
    `,
  ];
}

const FILES_ROUTE_NAMESPACE = "core.workspace.files";
const SELECTION_QUERY_KEY = "file";

export function workspaceUploadReviewError(files: readonly File[], destinationFolder: string): string | undefined {
  if (files.length === 0) return "Choose at least one file to upload.";
  for (const file of files) {
    try {
      workspaceUploadPath(destinationFolder, file.name);
    } catch (error) {
      return describeFilesError(error);
    }
  }
  return undefined;
}

function batchErrorResponse(error: unknown): WorkspaceUploadBatchErrorShape | undefined {
  if (!(error instanceof Error)) return undefined;
  if (!("failures" in error) || !Array.isArray(error.failures)) return undefined;
  const failures = error.failures;
  const responses = "responses" in error && Array.isArray(error.responses) ? error.responses : [];
  return { failures, responses };
}

function isUploadCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "WorkspaceUploadCancelledError";
}

function fileListToArray(files: FileList | null | undefined): File[] {
  return files === null || files === undefined ? [] : Array.from(files);
}

function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function workspaceModalLayerHost(panel: PiFilesPanel): HTMLElement {
  const root = panel.getRootNode();
  return root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : panel;
}

function uploadSummaryLabel(batches: readonly WorkspaceUploadBatchState[]): string {
  const uploading = batches.filter((batch) => batch.status === "uploading").length;
  return uploading === 0 ? `${String(batches.length)} recent` : `${String(uploading)} uploading`;
}

function uploadBatchTitle(batch: WorkspaceUploadBatchState): string {
  const count = batch.files.length;
  const files = count === 1 ? "file" : "files";
  switch (batch.status) {
    case "completed": return `Uploaded ${String(count)} ${files}`;
    case "error": return `Upload failed for ${String(count)} ${files}`;
    case "cancelled": return `Upload cancelled for ${String(count)} ${files}`;
    case "uploading": return `Uploading ${String(count)} ${files}`;
  }
}

export function uploadBatchStatusLabel(batch: WorkspaceUploadBatchState): string {
  switch (batch.status) {
    case "completed": return "Done";
    case "error": return "Failed";
    case "cancelled": return "Cancelled";
    case "uploading": return formatPercent(batch.percent);
  }
}

export function uploadBatchProgressValue(batch: WorkspaceUploadBatchState): number {
  return batch.status === "uploading" ? batch.percent : 1;
}

function uploadFileStatusLabel(file: WorkspaceUploadFileState): string {
  switch (file.status) {
    case "pending": return "Pending";
    case "uploading": return formatPercent(file.percent);
    case "completed": return "Done";
    case "error": return "Error";
    case "cancelled": return "Cancelled";
  }
}

function uploadFileDetail(file: WorkspaceUploadFileState): string {
  if (file.error !== undefined) return file.error;
  if (file.response !== undefined) return `Wrote ${file.response.path}`;
  return `${file.path} · ${formatFileSize(file.loaded)} / ${formatFileSize(file.total)}`;
}

function formatPercent(value: number): string {
  return `${String(Math.round(Math.max(0, Math.min(1, value)) * 100))}%`;
}
