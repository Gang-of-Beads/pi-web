import { css, html, nothing, type TemplateResult } from "lit";
import type { ProjectFolderContents, ProjectFolderEntry, ProjectFolderListing, ProjectFolderUnreadableCause } from "@gang-of-beads/pi-web/plugin-api";
import type { FolderView } from "./projectFolderNavigator";

/**
 * The add-project folder browser's rendering (r67): the current folder's absolute path as
 * clickable steps, the Up and New folder tools, and the subfolder list with its explicit states.
 * Every path shown or opened here is one the machine answered; nothing is split or joined here.
 */

export interface FolderBrowserActions {
  readonly open: (path: string, label: string) => void;
  readonly startNewFolder: () => void;
}

export function renderFolderCrumbs(view: FolderView, actions: FolderBrowserActions): TemplateResult {
  if (view.kind !== "listed") return html`<div class="crumbs crumbs-pending">${pendingLabel(view)}</div>`;
  const { crumbs, separator } = view.listing;
  const pendingCreation = view.listing.contents.kind === "missing";
  return html`
    <nav class="crumbs" aria-label="Folder path">
      ${crumbs.map((crumb, index) => {
        const current = index === crumbs.length - 1;
        return html`${index > 1 ? html`<span class="crumb-separator" aria-hidden="true">${separator}</span>` : nothing}<button
          class=${current ? (pendingCreation ? "crumb current pending" : "crumb current") : "crumb"}
          aria-current=${current ? "location" : nothing}
          @click=${() => { actions.open(crumb.path, crumb.path); }}
        >${crumb.name}</button>`;
      })}
    </nav>
  `;
}

function pendingLabel(view: Exclude<FolderView, { kind: "listed" }>): string {
  return view.kind === "unsupported" ? "" : view.label;
}

export function renderFolderTools(view: FolderView, actions: FolderBrowserActions): TemplateResult {
  const listing = view.kind === "listed" ? view.listing : undefined;
  const parent = listing?.parent ?? null;
  return html`
    <div class="folder-tools">
      <button class="tool" aria-label="Go to parent folder" ?disabled=${parent === null} @click=${() => { if (parent !== null) actions.open(parent, parent); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6-6 6 6M12 4v16"/></svg>Up
      </button>
      <button class="tool new-folder" ?disabled=${listing === undefined} @click=${() => { actions.startNewFolder(); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3ZM12 11v6M9 14h6"/></svg>New folder
      </button>
    </div>
  `;
}

const UNREADABLE_WORDS: Readonly<Record<ProjectFolderUnreadableCause, string>> = {
  "not-a-folder": "This path is a file, not a folder.",
  denied: "PI WEB's account on this machine is not allowed to read this folder.",
  "timed-out": "This folder did not answer in time, so its subfolders are unknown.",
  failed: "This folder could not be read",
};

type PendingView = Exclude<FolderView, { kind: "listed" }>;
type PendingViewByKind = { readonly [V in PendingView as V["kind"]]: V };

/** What the list area says while no folder is listed; an unanswered listing is never shown as an empty one. */
const PENDING_VIEW_WORDS: { readonly [K in keyof PendingViewByKind]: (view: PendingViewByKind[K], machineName: string) => string } = {
  loading: () => "Loading folders…",
  unanswered: (view, machineName) => `${machineName} did not answer: ${view.reason}. Trying again…`,
  refused: (view, machineName) => `${machineName} refused this folder name: ${view.reason}`,
  unsupported: () => "This machine cannot list its folders. Enter a folder path instead.",
};

type ContentsByKind = { readonly [C in ProjectFolderContents as C["kind"]]: C };

/** The list area for each kind of listing; a folder that could not be read says why instead of reading as empty. */
const CONTENTS_RENDERERS: { readonly [K in keyof ContentsByKind]: (contents: ContentsByKind[K], listing: ProjectFolderListing, actions: FolderBrowserActions) => TemplateResult } = {
  complete: (contents, listing, actions) => renderFolders(listing, contents.folders, contents.folders.length === 0 ? "No subfolders. Add project adds this folder." : undefined, countLabel(contents.folders.length), actions),
  truncated: (contents, listing, actions) => renderFolders(listing, contents.folders, `Showing the first ${String(contents.folders.length)} of ${String(contents.total)} subfolders. Enter a path to reach the others.`, `First ${String(contents.folders.length)} of ${String(contents.total)} subfolders`, actions),
  incomplete: (contents, listing, actions) => renderFolders(listing, contents.folders, "This folder answered too slowly to check every linked folder; some subfolders may be missing.", `${countLabel(contents.folders.length)} found`, actions),
  missing: () => html`<div class="folder-state" role="status">This folder does not exist yet. Add project creates it.</div>`,
  unreadable: (contents) => html`<div class="folder-state" role="status">${unreadableWords(contents)}</div>`,
};

export function renderFolderList(view: FolderView, machineName: string, actions: FolderBrowserActions): TemplateResult {
  if (view.kind !== "listed") return html`<div class="folder-state" role="status">${pendingViewWords(view.kind, view, machineName)}</div>`;
  return renderContents(view.listing.contents.kind, view.listing.contents, view.listing, actions);
}

function pendingViewWords<K extends keyof PendingViewByKind>(kind: K, view: PendingViewByKind[K], machineName: string): string {
  return PENDING_VIEW_WORDS[kind](view, machineName);
}

function renderContents<K extends keyof ContentsByKind>(kind: K, contents: ContentsByKind[K], listing: ProjectFolderListing, actions: FolderBrowserActions): TemplateResult {
  return CONTENTS_RENDERERS[kind](contents, listing, actions);
}

function unreadableWords(contents: ContentsByKind["unreadable"]): string {
  if (contents.cause !== "failed") return UNREADABLE_WORDS[contents.cause];
  return contents.detail === undefined ? `${UNREADABLE_WORDS.failed}.` : `${UNREADABLE_WORDS.failed} (${contents.detail}).`;
}

function countLabel(count: number): string {
  return count === 1 ? "1 subfolder" : `${String(count)} subfolders`;
}

function renderFolders(listing: ProjectFolderListing, folders: readonly ProjectFolderEntry[], note: string | undefined, label: string, actions: FolderBrowserActions): TemplateResult {
  return html`
    <div class="folder-count">${label}</div>
    ${note === undefined ? nothing : html`<div class="folder-note" role="status">${note}</div>`}
    <ul class="folder-rows" aria-label=${`Subfolders of ${listing.path}`}>
      ${folders.map((folder) => html`<li><button class="folder-row" @click=${() => { actions.open(folder.path, folder.path); }}>
        <span class="folder-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3Z"/></svg></span>
        <span class="folder-name">${folder.name}</span>
        <svg class="folder-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
      </button></li>`)}
    </ul>
  `;
}

export const folderBrowserStyles = css`
  .path-shell { flex: 0 0 auto; display: flex; align-items: center; min-height: var(--pi-control-height-comfort, 44px); margin: 0 var(--pi-space-6); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); }
  .crumbs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; overflow-x: auto; scrollbar-width: none; padding-left: var(--pi-space-2); font: var(--pi-text-sm) var(--pi-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
  .crumbs::-webkit-scrollbar { display: none; }
  .crumbs-pending { color: var(--pi-muted); padding: 0 var(--pi-space-4); white-space: nowrap; }
  .dialog .crumb { box-sizing: border-box; flex: 0 0 auto; min-height: var(--pi-control-height-comfort, 44px); border: 0; background: transparent; color: var(--pi-muted); padding: 0 var(--pi-space-3); font: inherit; white-space: nowrap; }
  .dialog .crumb.current { color: var(--pi-text); font-weight: var(--pi-weight-semibold); }
  .dialog .crumb.pending { font-style: italic; }
  .crumb-separator { flex: 0 0 auto; color: var(--pi-muted); opacity: .7; }
  .dialog .path-toggle { box-sizing: border-box; flex: 0 0 auto; display: grid; place-items: center; width: var(--pi-control-height-comfort, 44px); min-height: var(--pi-control-height-comfort, 44px); border: 0; border-left: 1px solid var(--pi-border); border-radius: 0; background: transparent; color: var(--pi-accent); padding: 0; }
  .path-toggle svg, .tool svg, .folder-icon svg, .folder-chevron { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
  .folder-tools { flex: 0 0 auto; display: flex; justify-content: space-between; align-items: center; gap: var(--pi-space-4); padding: var(--pi-space-3) var(--pi-space-5) 0; }
  .dialog .tool { box-sizing: border-box; display: flex; align-items: center; gap: var(--pi-space-3); min-height: var(--pi-control-height-comfort, 44px); border: 0; background: transparent; color: var(--pi-muted); font-size: var(--pi-text-sm); }
  .dialog .tool.new-folder { color: var(--pi-accent); }
  .new-folder-form { flex: 0 0 auto; display: grid; grid-template-columns: 1fr auto auto; gap: var(--pi-space-3); align-items: center; padding: var(--pi-space-3) var(--pi-space-6) 0; }
  .new-folder-form .field-error { grid-column: 1 / -1; color: var(--pi-danger); font-size: var(--pi-text-sm); line-height: 1.35; }
  .folders { flex: 1 1 auto; height: min(360px, 45dvh); min-height: 120px; overflow-y: auto; overscroll-behavior: contain; padding: var(--pi-space-2) var(--pi-space-4) var(--pi-space-4); }
  .folder-count { padding: var(--pi-space-2) var(--pi-space-3) var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-xs, 11px); letter-spacing: .06em; text-transform: uppercase; }
  .folder-note, .folder-state { padding: var(--pi-space-4) var(--pi-space-3); color: var(--pi-muted); line-height: 1.4; }
  .folder-rows { list-style: none; margin: 0; padding: 0; }
  .dialog .folder-row { box-sizing: border-box; width: 100%; min-height: var(--pi-control-height-comfort, 44px); display: flex; align-items: center; gap: var(--pi-space-5); border: 0; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-text); padding: var(--pi-space-3) var(--pi-space-4); text-align: left; }
  .folder-icon { display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-accent); flex-shrink: 0; }
  .folder-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .folder-chevron { color: var(--pi-muted); }
  @media (hover: hover) { .dialog .folder-row:hover, .dialog .crumb:hover { background: var(--pi-selection-bg); } }
  .dialog .folder-row:focus-visible, .dialog .crumb:focus-visible, .dialog .tool:focus-visible, .dialog .path-toggle:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
  @media (pointer: coarse) {
    .path-shell, .dialog .crumb, .dialog .path-toggle, .dialog .tool, .dialog .folder-row { min-height: var(--pi-control-height-touch, 44px); }
    .dialog .path-toggle { width: var(--pi-control-height-touch, 44px); }
  }
`;
