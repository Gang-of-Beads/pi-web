import { css, html, nothing, type TemplateResult } from "lit";
import type { ProjectFolderContents, ProjectFolderEntry, ProjectFolderListing, ProjectFolderUnreadableCause } from "@gang-of-beads/pi-web/plugin-api";
import { fuzzyMatchedIndices } from "./fuzzyMatch";
import type { FolderView } from "./projectFolderNavigator";
import type { DeeperAnswer, DeeperFolder } from "./projectFolderSearch";

/**
 * The add-project folder browser's rendering (r67): the current folder's absolute path as
 * clickable steps, the Up and New folder tools, the quick search (r171), and the subfolder list
 * with its explicit states. Every path shown or opened here is one the machine answered; nothing
 * is split or joined here.
 */

export interface FolderBrowserActions {
  readonly open: (path: string, label: string) => void;
  readonly startNewFolder: () => void;
  /** The project the dialog's machine already has at exactly this folder. */
  readonly projectAt: (path: string) => { readonly name: string } | undefined;
  readonly openProject: (path: string) => void;
  /** The folder whose project its pill is opening, while that submit is in flight. */
  readonly openingProject: () => string | undefined;
  /** Whether any submit is in flight; the pills wait for it. */
  readonly submitting: () => boolean;
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

/** What a listing that answered too slowly owes the reader, in the list and in a search over it. */
const INCOMPLETE_LISTING_NOTE = "This folder answered too slowly to check every linked folder; some subfolders may be missing.";

/** The list area for each kind of listing; a folder that could not be read says why instead of reading as empty. */
const CONTENTS_RENDERERS: { readonly [K in keyof ContentsByKind]: (contents: ContentsByKind[K], listing: ProjectFolderListing, actions: FolderBrowserActions) => TemplateResult } = {
  complete: (contents, listing, actions) => renderFolders(listing, contents.folders, contents.folders.length === 0 ? `No subfolders. ${actions.projectAt(listing.path) === undefined ? "Add project adds this folder." : "Open project opens it."}` : undefined, countLabel(contents.folders.length), actions),
  truncated: (contents, listing, actions) => renderFolders(listing, contents.folders, `Showing the first ${String(contents.folders.length)} of ${String(contents.total)} subfolders. Enter a path to reach the others.`, `First ${String(contents.folders.length)} of ${String(contents.total)} subfolders`, actions),
  incomplete: (contents, listing, actions) => renderFolders(listing, contents.folders, INCOMPLETE_LISTING_NOTE, `${countLabel(contents.folders.length)} found`, actions),
  missing: (_contents, listing, actions) => html`<div class="folder-state" role="status">${actions.projectAt(listing.path) === undefined ? "This folder does not exist yet. Add project creates it." : "This folder does not exist. Open project creates it again."}</div>`,
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
      ${folders.map((folder) => renderFolderRow(folder, folder.name, undefined, actions))}
    </ul>
  `;
}

/**
 * One folder row. Activating it always opens the folder, so a reader can go inside a project to add
 * a subfolder; a folder that is already a project carries a pill that opens that project instead
 * of the chevron.
 */
function renderFolderRow(folder: ProjectFolderEntry, name: TemplateResult | string, location: string | undefined, actions: FolderBrowserActions): TemplateResult {
  const project = actions.projectAt(folder.path);
  return html`<li class="folder-item"><button class="folder-row" @click=${() => { actions.open(folder.path, folder.path); }}>
    <span class="folder-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3Z"/></svg></span>
    <span class="folder-label"><span class="folder-name">${name}</span>${location === undefined ? nothing : html`<span class="folder-location">${location}</span>`}</span>
    ${project === undefined ? html`<svg class="folder-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>` : nothing}
  </button>${project === undefined ? nothing : html`<button class="project-pill" aria-label=${`Already a project, open ${project.name}`} ?disabled=${actions.submitting()} @click=${() => { actions.openProject(folder.path); }}>${actions.openingProject() === folder.path ? "Opening…" : "Already a project"}</button>`}</li>`;
}

function folderName(listing: ProjectFolderListing): string {
  return listing.crumbs.at(-1)?.name ?? listing.path;
}

type ContentsNotes = { readonly [K in keyof ContentsByKind]: (contents: ContentsByKind[K]) => string | undefined };

/**
 * What a search over a listing owes the reader about subfolders the listing does not hold: a big
 * folder lists only its first 500, and a slow one may miss linked folders. Without it a search
 * answered "No folders match" for a subfolder past the first 500 (review of the folder search).
 */
const SEARCH_NOTES: ContentsNotes = {
  complete: () => undefined,
  truncated: (contents) => `Only the first ${String(contents.folders.length)} of ${String(contents.total)} subfolders are listed here; Deeper searches the others too.`,
  incomplete: () => INCOMPLETE_LISTING_NOTE,
  missing: () => undefined,
  unreadable: () => undefined,
};

function searchNote<K extends keyof ContentsByKind>(kind: K, contents: ContentsByKind[K]): string | undefined {
  return SEARCH_NOTES[kind](contents);
}

/** The query's matched characters in the accent colour. */
function highlightedName(name: string, query: string): TemplateResult {
  const matched = fuzzyMatchedIndices(name, query);
  const runs: { text: string; matched: boolean }[] = [];
  for (let index = 0; index < name.length; index += 1) {
    const isMatched = matched.has(index);
    const last = runs.at(-1);
    if (last?.matched === isMatched) last.text += name.charAt(index);
    else runs.push({ text: name.charAt(index), matched: isMatched });
  }
  return html`${runs.map((run) => (run.matched ? html`<mark class="folder-match">${run.text}</mark>` : run.text))}`;
}

/** The search field; with no listing (the next folder still loading) it is drawn disabled, keeping its place. */
export function renderFolderSearchField(listing: ProjectFolderListing | undefined, query: string, onInput: ((query: string) => void) | undefined): TemplateResult {
  const label = listing === undefined ? "Search in this folder" : `Search in ${folderName(listing)}`;
  return html`
    <label class="folder-search">
      <span class="visually-hidden">${label}</span>
      <input
        type="text"
        .value=${query}
        ?disabled=${onInput === undefined}
        placeholder=${label}
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        enterkeyhint="go"
        @input=${(event: InputEvent) => { if (event.target instanceof HTMLInputElement) onInput?.(event.target.value); }}
      />
    </label>
  `;
}

type DeeperAnswerByKind = { readonly [A in DeeperAnswer as A["kind"]]: A };

const DEEPER_HEADING = html`<div class="folder-count">Deeper · 3 levels</div>`;

/** The deeper section for each state of the machine's search; an unanswered search is never shown as empty. */
const DEEPER_RENDERERS: { readonly [K in keyof DeeperAnswerByKind]: (answer: DeeperAnswerByKind[K], query: string, actions: FolderBrowserActions) => TemplateResult } = {
  searching: () => html`${DEEPER_HEADING}<div class="folder-state" role="status">Searching deeper…</div>`,
  answered: (answer, query, actions) => answer.folders.length === 0 ? html`` : html`
    ${DEEPER_HEADING}
    <ul class="folder-rows" aria-label="Deeper folders">
      ${answer.folders.map((folder: DeeperFolder) => renderFolderRow(folder, highlightedName(folder.name, query), folder.location === folder.name ? undefined : folder.location, actions))}
    </ul>
  `,
  failed: (answer) => html`${DEEPER_HEADING}<div class="folder-state" role="status">Couldn't search deeper: ${answer.reason}</div>`,
  skipped: () => html``,
};

function renderDeeper<K extends keyof DeeperAnswerByKind>(kind: K, answer: DeeperAnswerByKind[K], query: string, actions: FolderBrowserActions): TemplateResult {
  return DEEPER_RENDERERS[kind](answer, query, actions);
}

/** The two search sections: the listing's matching subfolders, at once, then the machine's deeper folders. */
export function renderFolderSearchResults(listing: ProjectFolderListing, query: string, matches: readonly ProjectFolderEntry[], deeper: DeeperAnswer, actions: FolderBrowserActions): TemplateResult {
  const note = searchNote(listing.contents.kind, listing.contents);
  const noteRow = note === undefined ? nothing : html`<div class="folder-note" role="status">${note}</div>`;
  if (matches.length === 0 && deeper.kind === "answered" && deeper.folders.length === 0) return html`${noteRow}<div class="folder-state" role="status">No folders match</div>`;
  return html`
    ${noteRow}
    <div class="folder-count">In ${folderName(listing)} · ${matches.length}</div>
    ${matches.length === 0 ? nothing : html`<ul class="folder-rows" aria-label=${`Subfolders of ${listing.path}`}>
      ${matches.map((folder) => renderFolderRow(folder, highlightedName(folder.name, query), undefined, actions))}
    </ul>`}
    ${renderDeeper(deeper.kind, deeper, query, actions)}
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
  .folder-search { flex: 0 0 auto; display: flex; padding: var(--pi-space-3) var(--pi-space-6) 0; }
  .dialog .folder-search input { box-sizing: border-box; width: 100%; height: var(--pi-control-height-comfort, 36px); min-height: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); padding: 0 var(--pi-space-5); font-family: inherit; font-size: var(--pi-control-font-size, 16px); box-shadow: none; }
  .dialog .folder-search input:focus, .dialog .folder-search input:focus-visible { border-color: var(--pi-accent); outline: none; box-shadow: none; }
  .folders { flex: 1 1 auto; height: min(360px, 45dvh); min-height: 120px; overflow-y: auto; overscroll-behavior: contain; padding: var(--pi-space-2) var(--pi-space-4) var(--pi-space-4); }
  .folder-count { padding: var(--pi-space-2) var(--pi-space-3) var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-xs, 11px); letter-spacing: .06em; text-transform: uppercase; }
  .folder-note, .folder-state { padding: var(--pi-space-4) var(--pi-space-3); color: var(--pi-muted); line-height: 1.4; }
  .folder-rows { list-style: none; margin: 0; padding: 0; }
  .folder-item { display: flex; align-items: center; gap: var(--pi-space-3); }
  .dialog .folder-row { box-sizing: border-box; flex: 1 1 auto; min-width: 0; width: 100%; min-height: var(--pi-control-height-comfort, 44px); display: flex; align-items: center; gap: var(--pi-space-5); border: 0; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-text); padding: var(--pi-space-3) var(--pi-space-4); text-align: left; }
  .folder-icon { display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-accent); flex-shrink: 0; }
  .folder-label { flex: 1 1 auto; min-width: 0; display: grid; gap: var(--pi-space-1); }
  .folder-name, .folder-location { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .folder-location { color: var(--pi-muted); font: var(--pi-text-xs, 11px) var(--pi-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
  .folder-match { background: transparent; color: var(--pi-accent); font-weight: var(--pi-weight-semibold); }
  .folder-chevron { color: var(--pi-muted); }
  .dialog .project-pill { box-sizing: border-box; flex: 0 0 auto; min-height: var(--pi-control-height-comfort, 36px); margin-right: var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); background: transparent; color: var(--pi-muted); padding: 0 var(--pi-space-5); font-size: var(--pi-text-sm); white-space: nowrap; }
  @media (hover: hover) { .dialog .folder-row:hover, .dialog .crumb:hover { background: var(--pi-selection-bg); } }
  @media (hover: hover) { .dialog .project-pill:hover { color: var(--pi-text); border-color: var(--pi-accent); } }
  .dialog .folder-row:focus-visible, .dialog .crumb:focus-visible, .dialog .tool:focus-visible, .dialog .path-toggle:focus-visible, .dialog .project-pill:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
  @media (pointer: coarse) {
    .path-shell, .dialog .crumb, .dialog .path-toggle, .dialog .tool, .dialog .folder-row, .dialog .project-pill { min-height: var(--pi-control-height-touch, 44px); }
    .dialog .folder-search input { height: var(--pi-control-height-touch, 44px); }
    .dialog .path-toggle { width: var(--pi-control-height-touch, 44px); }
  }
`;
