import { css, html, type ReactiveController, type ReactiveControllerHost, type TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import type { FileContentResponse, StagedFile, StagedFileRequest, StagedFileStage, StagedFileState } from "@gang-of-beads/pi-web/plugin-api";
import { formatFileSize, workspaceFileName } from "./format";

/**
 * The Files viewer's progressive preview of a photo, a video or an audio file. The host loads the
 * file's stages (`files.stagedFile`) as its loading rule allows; this only draws them. A photo shows
 * its blurred look at once, then its 512 px thumbnail, then the photo, each over the one before
 * until it has loaded; a video shows its cover and plays on ▶; audio shows its length and size and
 * plays on ▶. A machine that cannot make previews says so, and a file over the preview limit still
 * shows its thumbnail or cover. A stage the machine does not answer for is asked for again by the
 * host while what is shown stays; there is no failed state to dismiss (B48). An original the host
 * delivered but the browser cannot show (a photo it cannot decode, a stream that breaks while it
 * plays) calls the viewer's `onError`, which keeps the viewer's own failure state and retry from
 * before stages. Each selection gets its own stages, cancelled when the selection changes or the
 * viewer goes away.
 */

export type FilesStagedFileBuilder = (path: string, request: StagedFileRequest) => StagedFile;
export type StagedPreviewKind = "image" | "video" | "audio";

const STAGES: Record<StagedPreviewKind, { readonly before: readonly StagedFileStage[]; readonly original: StagedFileStage }> = {
  image: { before: [{ name: "info", kind: "info" }, { name: "thumbnail-512", kind: "image" }], original: { name: "original", kind: "original-image" } },
  video: { before: [{ name: "info", kind: "info" }, { name: "poster-512", kind: "image" }], original: { name: "original", kind: "original-stream" } },
  audio: { before: [{ name: "info", kind: "info" }], original: { name: "original", kind: "original-stream" } },
};

/** The layers a photo draws, bottom first; each is dropped once a layer above it has loaded. */
const IMAGE_LAYERS = ["placeholder", "thumbnail-512", "original"];

export function stagedFileRequest(file: FileContentResponse, kind: StagedPreviewKind, previewable: boolean): StagedFileRequest {
  const stages = STAGES[kind];
  return { version: { size: file.size, modifiedAt: file.modifiedAt }, stages: previewable ? [...stages.before, stages.original] : stages.before };
}

export class StagedPreview implements ReactiveController {
  private staged: StagedFile | undefined;
  private unsubscribe: (() => void) | undefined;
  private key: string | undefined;
  private observed: Element | undefined;
  /** The image each stage drew, so a stage stays under the next one until that has loaded. */
  private readonly drawn = new Map<string, string>();
  private loadedLayer: string | undefined;

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostDisconnected(): void {
    this.release();
  }

  /** Follows the viewer's selection: new stages for a new file, and the old ones cancelled. */
  select(key: string, open: (() => StagedFile) | undefined): void {
    if (key === this.key) return;
    this.release();
    this.key = key;
    if (open === undefined) return;
    const staged = open();
    this.staged = staged;
    this.unsubscribe = staged.subscribe((state) => {
      if (state.shown?.url !== undefined) this.drawn.set(state.shown.name, state.shown.url);
      this.host.requestUpdate();
    });
  }

  get active(): boolean {
    return this.staged !== undefined;
  }

  /** Starts the stages once the element showing them is on screen. */
  observe(element: Element | null): void {
    if (this.staged === undefined || element === null || element === this.observed) return;
    this.observed = element;
    this.staged.observe(element);
  }

  renderImage(file: FileContentResponse, previewable: boolean, limitLabel: string, onError: () => void): TemplateResult {
    const state = this.state();
    const layers = IMAGE_LAYERS.flatMap((name) => {
      const url = name === "placeholder" ? state.placeholder : this.drawn.get(name);
      return url === undefined ? [] : [{ name, url }];
    });
    const visible = layers.slice(Math.max(0, layers.findIndex((layer) => layer.name === this.loadedLayer)));
    const top = visible.at(-1)?.name;
    const box = sizeOf(state);
    return html`
      <div class="image-preview staged-image" data-stages>
        ${visible.length === 0 ? this.renderCard(file, state) : visible.map((layer) => html`
          <img
            class="stage-layer"
            src=${layer.url}
            width=${ifDefined(layer.name === "original" ? undefined : box?.width)}
            height=${ifDefined(layer.name === "original" ? undefined : box?.height)}
            alt=${layer.name === top ? `Preview of ${file.path}` : ""}
            aria-hidden=${layer.name === top ? "false" : "true"}
            decoding="async"
            @load=${() => { this.layerLoaded(layer.name); }}
            @error=${layer.name === "original" ? onError : () => undefined}
          />
        `)}
      </div>
      ${this.renderNote(file, state, previewable ? undefined : `The full image is ${formatFileSize(file.size)}, over the ${limitLabel} preview limit. Use Download above.`)}
    `;
  }

  renderMedia(file: FileContentResponse, kind: "video" | "audio", previewable: boolean, limitLabel: string, onError: () => void): TemplateResult {
    const state = this.state();
    const original = this.drawn.get("original");
    const cover = this.drawn.get("poster-512") ?? state.placeholder;
    const box = sizeOf(state);
    if (original !== undefined) {
      return kind === "video"
        ? html`<div class="media-preview"><video controls playsinline autoplay preload="metadata" src=${original} poster=${ifDefined(cover)} referrerpolicy="no-referrer" @error=${onError}>Your browser cannot play this video file.</video></div>`
        : html`<div class="media-preview"><audio controls autoplay preload="metadata" src=${original} referrerpolicy="no-referrer" @error=${onError}>Your browser cannot play this audio file.</audio></div>`;
    }
    const facts = [state.info?.durationS === undefined ? undefined : formatDuration(state.info.durationS), formatFileSize(file.size)].filter((fact) => fact !== undefined).join(" · ");
    const name = workspaceFileName(file.path);
    return html`
      <div class="media-preview staged-media" data-stages>
        <button class=${kind === "video" ? "play-key video" : "play-key audio"} type="button" ?disabled=${!previewable} aria-label=${`Play ${name}, ${facts}`} @click=${() => { this.staged?.advance(); }}>
          ${kind === "video" && cover !== undefined ? html`<img class="play-cover" src=${cover} width=${ifDefined(box?.width)} height=${ifDefined(box?.height)} alt="" aria-hidden="true" />` : null}
          <span class="play-label" aria-hidden="true"><svg class="play-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 5 11 7-11 7z"></path></svg>${facts}</span>
        </button>
      </div>
      ${this.renderNote(file, state, previewable ? undefined : `This file is ${formatFileSize(file.size)}, over the ${limitLabel} preview limit. Use Download above.`)}
    `;
  }

  private renderCard(file: FileContentResponse, state: StagedFileState): TemplateResult {
    return html`
      <div class="stage-card">
        <strong>${workspaceFileName(file.path)}</strong>
        <span>${formatFileSize(file.size)}${state.status === "shown" || state.status === "unavailable" ? "" : " · loading the preview…"}</span>
      </div>
    `;
  }

  /**
   * One line under the preview: how much of the full image has arrived (not announced, as it changes
   * twice a second), what is being asked for again, or why nothing at all could be made.
   */
  private renderNote(file: FileContentResponse, state: StagedFileState, overLimit: string | undefined): TemplateResult | null {
    if (state.status === "loading" && state.next?.kind === "original-image") {
      const arrived = state.next.loaded === undefined ? "" : `${formatFileSize(state.next.loaded)} of `;
      const left = state.next.estimateMs === undefined ? "" : ` · ${formatTimeLeft(state.next.estimateMs)}`;
      return html`<p class="stage-note">Loading the full image · ${arrived}${formatFileSize(file.size)}${left}</p>`;
    }
    if (state.status === "retrying") {
      return html`<p class="stage-note" role="status">${state.next?.kind === "original-image" ? "The full image" : "The preview"} did not arrive · asking again</p>`;
    }
    if (state.reason !== undefined && this.drawn.size === 0 && state.placeholder === undefined && state.info === undefined) {
      return html`<p class="stage-note" role="status">No preview: ${state.reason}.</p>`;
    }
    return overLimit === undefined ? null : html`<p class="stage-note" role="status">${overLimit}</p>`;
  }

  private state(): StagedFileState {
    return this.staged?.state ?? { status: "idle" };
  }

  private layerLoaded(name: string): void {
    if (IMAGE_LAYERS.indexOf(name) <= IMAGE_LAYERS.indexOf(this.loadedLayer ?? "")) return;
    this.loadedLayer = name;
    this.host.requestUpdate();
  }

  private release(): void {
    this.unsubscribe?.();
    this.staged?.cancel();
    this.unsubscribe = undefined;
    this.staged = undefined;
    this.key = undefined;
    this.observed = undefined;
    this.drawn.clear();
    this.loadedLayer = undefined;
  }
}

function sizeOf(state: StagedFileState): { width: number; height: number } | undefined {
  const width = state.info?.width;
  const height = state.info?.height;
  return width === undefined || height === undefined ? undefined : { width, height };
}

function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${rest}` : `${String(minutes)}:${rest}`;
}

function formatTimeLeft(ms: number): string {
  if (ms < 1_000) return "almost done";
  if (ms < 60_000) return `about ${String(Math.round(ms / 1_000))} s left`;
  return `about ${String(Math.round(ms / 60_000))} min left`;
}

export const stagedPreviewStyles = css`
  .image-preview.staged-image { display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); place-items: center; }
  .stage-layer { grid-area: 1 / 1; display: block; max-width: 100%; height: auto; object-fit: contain; border-radius: var(--pi-radius-md); }
  .stage-card { display: flex; flex-direction: column; align-items: center; gap: var(--pi-space-2); padding: var(--pi-space-8); border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-muted); text-align: center; overflow-wrap: anywhere; }
  .stage-card strong { color: var(--pi-text); font-weight: var(--pi-weight-semibold); }
  .stage-note { margin: 0; padding: 0 var(--pi-space-7) var(--pi-space-6); color: var(--pi-muted); font-size: var(--pi-text-xs); text-align: center; overflow-wrap: anywhere; }
  .play-key { position: relative; display: grid; place-items: center; max-width: 100%; padding: 0; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); font: inherit; cursor: pointer; overflow: hidden; }
  .play-key:disabled { cursor: default; opacity: var(--pi-disabled-opacity); }
  .play-key.audio { box-sizing: border-box; min-height: var(--pi-control-height-comfort); padding: var(--pi-space-4) var(--pi-space-7); border-radius: var(--pi-radius-md); }
  .play-key.video { min-width: min(100%, 320px); min-height: 180px; background: #000; }
  .play-cover { grid-area: 1 / 1; display: block; max-width: 100%; height: auto; }
  .play-label { grid-area: 1 / 1; z-index: 1; display: inline-flex; align-items: center; gap: var(--pi-space-4); box-sizing: border-box; min-height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-6); border-radius: var(--pi-radius-pill); background: color-mix(in srgb, var(--pi-bg) 82%, transparent); color: var(--pi-text); font-size: var(--pi-text-sm); }
  .play-mark { flex: 0 0 auto; width: 14px; height: 14px; }
  .play-key:not(:disabled) .play-mark { color: var(--pi-accent); }
  .play-key:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
  @media (pointer: coarse) { .play-key.audio { min-height: var(--pi-control-height-touch); } }
`;
